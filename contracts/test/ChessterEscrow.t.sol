// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../src/ChessterEscrow.sol";

contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        require(balanceOf[from] >= amount, "insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/**
 * @dev In the redesigned contract ALL match operations are coordinator-gated.
 *      The test contract itself deploys ChessterEscrow, so address(this) IS the coordinator.
 *
 *      Flow:
 *        1. player1 approves escrow for wagerAmount
 *        2. coordinator (this) calls createMatch(gameCode, player1, token, wagerAmount)
 *        3. player2 approves escrow for wagerAmount
 *        4. coordinator (this) calls joinMatch(gameCode, player2)
 *        5. coordinator calls resolveMatch(gameCode, winner)
 */
contract ChessterEscrowTest is Test {
    ChessterEscrow public escrow;
    MockERC20      public token;

    address public player1;
    address public player2;

    bytes32 public gameCode    = keccak256("GAME001");
    uint256 public wagerAmount = 1 ether;

    function setUp() public {
        player1 = makeAddr("player1");
        player2 = makeAddr("player2");

        // Deploy — address(this) becomes coordinator
        escrow = new ChessterEscrow();
        token  = new MockERC20();

        // Mint tokens to players
        token.mint(player1, 100 ether);
        token.mint(player2, 100 ether);
    }

    // ── Helper: players approve + coordinator creates & joins ─────────────────

    function _setupMatch() internal {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        vm.prank(player2);
        token.approve(address(escrow), wagerAmount);
        escrow.joinMatch(gameCode, player2);
    }

    // ── Create match ──────────────────────────────────────────────────────────

    function test_CreateMatch() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);

        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(m.player1,     player1);
        assertEq(m.token,       address(token));
        assertEq(m.wagerAmount, wagerAmount);
        assertEq(m.totalStaked, wagerAmount);
        assertEq(uint256(m.status), 0); // PENDING
    }

    function testFail_CreateMatch_NoApproval() public {
        // player1 did NOT approve — should revert
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);
    }

    function testFail_CreateMatch_Duplicate() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount * 2);

        escrow.createMatch(gameCode, player1, address(token), wagerAmount);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount); // duplicate
    }

    // ── Join match ────────────────────────────────────────────────────────────

    function test_JoinMatch() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        vm.prank(player2);
        token.approve(address(escrow), wagerAmount);
        escrow.joinMatch(gameCode, player2);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(m.player2,     player2);
        assertEq(m.totalStaked, 2 ether);
        assertEq(uint256(m.status), 1); // ACTIVE
    }

    function testFail_JoinOwnMatch() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount * 2);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        // player1 tries to join their own match
        escrow.joinMatch(gameCode, player1);
    }

    function testFail_JoinMatch_NotCoordinator() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        vm.prank(player2);
        token.approve(address(escrow), wagerAmount);

        // player2 tries to call joinMatch directly (not coordinator)
        vm.prank(player2);
        escrow.joinMatch(gameCode, player2);
    }

    // ── Resolve: winner ───────────────────────────────────────────────────────

    function test_ResolveMatch_Winner() public {
        _setupMatch();

        uint256 tokenBalBefore = token.balanceOf(player1);
        escrow.resolveMatch(gameCode, player1);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(uint256(m.status), 2); // RESOLVED
        assertEq(m.winner, player1);

        // player1 gets 95% of 2 ether = 1.9 ether
        assertEq(token.balanceOf(player1) - tokenBalBefore, 1.9 ether);
        // coordinator gets 5% = 0.1 ether  (coordinator == address(this))
        assertEq(token.balanceOf(address(this)), 0.1 ether);
    }

    function test_ResolveMatch_Player2Wins() public {
        _setupMatch();

        uint256 balBefore = token.balanceOf(player2);
        escrow.resolveMatch(gameCode, player2);

        assertEq(token.balanceOf(player2) - balBefore, 1.9 ether);
    }

    // ── Resolve: draw ─────────────────────────────────────────────────────────

    function test_ResolveMatch_Draw() public {
        _setupMatch();

        uint256 bal1Before = token.balanceOf(player1);
        uint256 bal2Before = token.balanceOf(player2);

        escrow.resolveMatch(gameCode, address(0xdead));

        // Each player refunded their wager in full (no admin cut on draw)
        assertEq(token.balanceOf(player1) - bal1Before, wagerAmount);
        assertEq(token.balanceOf(player2) - bal2Before, wagerAmount);
        // Coordinator gets nothing on a draw
        assertEq(token.balanceOf(address(this)), 0);
    }

    // ── Timeout refund ────────────────────────────────────────────────────────

    function test_RefundAfterTimeout_PendingMatch() public {
        // Only player1 has deposited (PENDING state)
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 balBefore = token.balanceOf(player1);
        escrow.refundAfterTimeout(gameCode);

        assertEq(token.balanceOf(player1) - balBefore, wagerAmount);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(uint256(m.status), 3); // REFUNDED
    }

    function test_RefundAfterTimeout_ActiveMatch() public {
        _setupMatch(); // Both deposited, status = ACTIVE

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 bal1Before = token.balanceOf(player1);
        uint256 bal2Before = token.balanceOf(player2);

        escrow.refundAfterTimeout(gameCode);

        assertEq(token.balanceOf(player1) - bal1Before, wagerAmount);
        assertEq(token.balanceOf(player2) - bal2Before, wagerAmount);
    }

    function testFail_RefundTooEarly() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);

        // Must wait 1 hour — should revert
        escrow.refundAfterTimeout(gameCode);
    }

    // ── Access control ────────────────────────────────────────────────────────

    function testFail_ResolveNotCoordinator() public {
        _setupMatch();

        vm.prank(player1); // player1 is NOT coordinator
        escrow.resolveMatch(gameCode, player1);
    }

    function testFail_CreateMatch_NotCoordinator() public {
        vm.prank(player1);
        token.approve(address(escrow), wagerAmount);

        vm.prank(player1); // player1 is NOT coordinator
        escrow.createMatch(gameCode, player1, address(token), wagerAmount);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    function test_SetCoordinator() public {
        address newCoord = makeAddr("newCoord");
        escrow.setCoordinator(newCoord);
        assertEq(escrow.coordinator(), newCoord);
    }

    function testFail_SetCoordinator_NotCoordinator() public {
        vm.prank(player1);
        escrow.setCoordinator(player1);
    }
}

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

contract ChessterEscrowTest is Test {
    receive() external payable {}
    ChessterEscrow public escrow;
    MockERC20 public token;

    address public coordinator;
    address public player1;
    address public player2;

    bytes32 public gameCode = keccak256("GAME001");
    uint256 public wagerAmount = 1 ether;

    function setUp() public {
        coordinator = address(this);
        player1 = makeAddr("player1");
        player2 = makeAddr("player2");

        escrow = new ChessterEscrow();
        token = new MockERC20();

        // Fund players
        vm.deal(player1, 10 ether);
        vm.deal(player2, 10 ether);

        // Mint tokens
        token.mint(player1, 100 ether);
        token.mint(player2, 100 ether);
    }

    // --- ETH Match Tests ---

    function test_CreateMatch_ETH() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode, address(0), 0);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(m.player1, player1);
        assertEq(m.wagerAmount, wagerAmount);
        assertEq(uint256(m.status), 0); // PENDING
    }

    function test_JoinMatch_ETH() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode, address(0), 0);

        vm.prank(player2);
        escrow.joinMatch{value: wagerAmount}(gameCode);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(m.player2, player2);
        assertEq(m.totalStaked, 2 ether);
        assertEq(uint256(m.status), 1); // ACTIVE
    }

    function test_ResolveMatch_Winner() public {
        _createAndJoinETH();

        uint256 balBefore = player1.balance;
        escrow.resolveMatch(gameCode, player1);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(uint256(m.status), 2); // RESOLVED
        assertEq(m.winner, player1);

        // Winner gets 95% of 2 ETH = 1.9 ETH
        assertEq(player1.balance - balBefore, 1.9 ether);
    }

    function test_ResolveMatch_Draw() public {
        _createAndJoinETH();

        uint256 bal1Before = player1.balance;
        uint256 bal2Before = player2.balance;

        escrow.resolveMatch(gameCode, address(0xdead));

        assertEq(player1.balance - bal1Before, wagerAmount);
        assertEq(player2.balance - bal2Before, wagerAmount);
    }

    function test_RefundAfterTimeout() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode, address(0), 0);

        // Fast forward 1 hour
        vm.warp(block.timestamp + 1 hours + 1);

        uint256 balBefore = player1.balance;
        escrow.refundAfterTimeout(gameCode);

        assertEq(player1.balance - balBefore, wagerAmount);
    }

    // --- Revert Tests ---

    function testFail_JoinOwnMatch() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode, address(0), 0);

        vm.prank(player1);
        escrow.joinMatch{value: wagerAmount}(gameCode);
    }

    function testFail_ResolveNotCoordinator() public {
        _createAndJoinETH();

        vm.prank(player1);
        escrow.resolveMatch(gameCode, player1);
    }

    function testFail_RefundTooEarly() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode, address(0), 0);

        escrow.refundAfterTimeout(gameCode);
    }

    // --- ERC20 Match Tests ---

    function test_CreateAndJoin_ERC20() public {
        vm.startPrank(player1);
        token.approve(address(escrow), wagerAmount);
        escrow.createMatch(gameCode, address(token), wagerAmount);
        vm.stopPrank();

        vm.startPrank(player2);
        token.approve(address(escrow), wagerAmount);
        escrow.joinMatch(gameCode);
        vm.stopPrank();

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(uint256(m.status), 1); // ACTIVE
        assertEq(m.totalStaked, 2 ether);
    }

    // --- Helpers ---

    function _createAndJoinETH() internal {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode, address(0), 0);

        vm.prank(player2);
        escrow.joinMatch{value: wagerAmount}(gameCode);
    }
}

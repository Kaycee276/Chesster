// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Test.sol";
import "../src/ChessterEscrow.sol";

/**
 * @dev In the redesigned contract:
 *   - Players call createMatch/joinMatch directly with ETH (payable).
 *   - Only the coordinator calls resolveMatch.
 *   - The test contract itself deploys ChessterEscrow, so address(this) IS the coordinator.
 *
 * Flow:
 *   1. player1 calls createMatch(gameCode) with msg.value = wagerAmount
 *   2. player2 calls joinMatch(gameCode)  with msg.value = wagerAmount
 *   3. coordinator (this) calls resolveMatch(gameCode, winner)
 */
contract ChessterEscrowTest is Test {
    ChessterEscrow public escrow;

    address public player1;
    address public player2;

    bytes32 public gameCode    = keccak256("GAME001");
    uint256 public wagerAmount = 1 ether;

    function setUp() public {
        player1 = makeAddr("player1");
        player2 = makeAddr("player2");

        // Give players ETH
        vm.deal(player1, 100 ether);
        vm.deal(player2, 100 ether);

        // Deploy — address(this) becomes coordinator
        escrow = new ChessterEscrow();
    }

    // ── Helper: players deposit ETH and match becomes ACTIVE ─────────────────

    function _setupMatch() internal {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        vm.prank(player2);
        escrow.joinMatch{value: wagerAmount}(gameCode);
    }

    // ── Create match ──────────────────────────────────────────────────────────

    function test_CreateMatch() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(m.player1,     player1);
        assertEq(m.wagerAmount, wagerAmount);
        assertEq(m.totalStaked, wagerAmount);
        assertEq(uint256(m.status), 0); // PENDING
        assertEq(address(escrow).balance, wagerAmount);
    }

    function testFail_CreateMatch_ZeroValue() public {
        vm.prank(player1);
        escrow.createMatch{value: 0}(gameCode); // should revert
    }

    function testFail_CreateMatch_Duplicate() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode); // duplicate — should revert
    }

    // ── Join match ────────────────────────────────────────────────────────────

    function test_JoinMatch() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        vm.prank(player2);
        escrow.joinMatch{value: wagerAmount}(gameCode);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(m.player2,     player2);
        assertEq(m.totalStaked, 2 ether);
        assertEq(uint256(m.status), 1); // ACTIVE
        assertEq(address(escrow).balance, 2 ether);
    }

    function testFail_JoinOwnMatch() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        // player1 tries to join their own match
        vm.prank(player1);
        escrow.joinMatch{value: wagerAmount}(gameCode);
    }

    function testFail_JoinMatch_WrongAmount() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        vm.prank(player2);
        escrow.joinMatch{value: wagerAmount / 2}(gameCode); // wrong amount — should revert
    }

    // ── Resolve: winner ───────────────────────────────────────────────────────

    function test_ResolveMatch_Winner() public {
        _setupMatch();

        uint256 balBefore      = player1.balance;
        uint256 coordBalBefore = address(this).balance;
        escrow.resolveMatch(gameCode, player1);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(uint256(m.status), 2); // RESOLVED
        assertEq(m.winner, player1);

        // player1 gets 95% of 2 ether = 1.9 ether
        assertEq(player1.balance - balBefore, 1.9 ether);
        // coordinator gets 5% = 0.1 ether  (coordinator == address(this))
        assertEq(address(this).balance - coordBalBefore, 0.1 ether);
    }

    function test_ResolveMatch_Player2Wins() public {
        _setupMatch();

        uint256 balBefore = player2.balance;
        escrow.resolveMatch(gameCode, player2);

        assertEq(player2.balance - balBefore, 1.9 ether);
    }

    // ── Resolve: draw ─────────────────────────────────────────────────────────

    function test_ResolveMatch_Draw() public {
        _setupMatch();

        uint256 bal1Before = player1.balance;
        uint256 bal2Before = player2.balance;

        escrow.resolveMatch(gameCode, address(0xdead));

        // Each player refunded their wager in full (no admin cut on draw)
        assertEq(player1.balance - bal1Before, wagerAmount);
        assertEq(player2.balance - bal2Before, wagerAmount);
        // Coordinator gets nothing on a draw
        assertEq(address(escrow).balance, 0);
    }

    // ── Timeout refund ────────────────────────────────────────────────────────

    function test_RefundAfterTimeout_PendingMatch() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 balBefore = player1.balance;
        escrow.refundAfterTimeout(gameCode);

        assertEq(player1.balance - balBefore, wagerAmount);

        ChessterEscrow.Match memory m = escrow.getMatch(gameCode);
        assertEq(uint256(m.status), 3); // REFUNDED
    }

    function test_RefundAfterTimeout_ActiveMatch() public {
        _setupMatch(); // Both deposited, status = ACTIVE

        vm.warp(block.timestamp + 1 hours + 1);

        uint256 bal1Before = player1.balance;
        uint256 bal2Before = player2.balance;

        escrow.refundAfterTimeout(gameCode);

        assertEq(player1.balance - bal1Before, wagerAmount);
        assertEq(player2.balance - bal2Before, wagerAmount);
    }

    function testFail_RefundTooEarly() public {
        vm.prank(player1);
        escrow.createMatch{value: wagerAmount}(gameCode);

        // Must wait 1 hour — should revert
        escrow.refundAfterTimeout(gameCode);
    }

    // ── Access control ────────────────────────────────────────────────────────

    function testFail_ResolveNotCoordinator() public {
        _setupMatch();

        vm.prank(player1); // player1 is NOT coordinator
        escrow.resolveMatch(gameCode, player1);
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

    // Allow this test contract to receive ETH (coordinator fee)
    receive() external payable {}
}

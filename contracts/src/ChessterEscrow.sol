// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

/**
 * @title ChessterEscrow
 * @dev Native-ETH escrow for wagered chess matches.
 *
 * Flow:
 *   1. Player1 calls createMatch(gameCode) with msg.value = wager amount.
 *   2. Player2 calls joinMatch(gameCode)  with msg.value = same wager amount.
 *   3. After the game ends, coordinator calls resolveMatch() to pay out.
 *
 * Payout:  winner 95%  |  coordinator (admin) 5%
 * Draw:    each player gets their wager back  (no admin cut)
 * Timeout: anyone can call refundAfterTimeout() 1 hour after creation
 *          to fully refund deposited players (no admin cut).
 */
contract ChessterEscrow {
    address public coordinator;

    uint256 public constant WINNER_BPS = 9500; // 95%
    uint256 public constant ADMIN_BPS  = 500;  // 5%
    uint256 public constant BPS_DENOM  = 10000;

    enum MatchStatus { PENDING, ACTIVE, RESOLVED, REFUNDED }

    struct Match {
        bytes32 gameCode;
        address player1;
        address player2;
        uint256 wagerAmount; // per-player stake in wei
        uint256 totalStaked;
        uint256 createdAt;
        MatchStatus status;
        address winner;
    }

    mapping(bytes32 => Match) public matches;

    // Special address used to signal a draw result
    address public constant DRAW = address(0xdead);

    // Events
    event MatchCreated(
        bytes32 indexed gameCode,
        address indexed player1,
        uint256 wagerAmount
    );
    event PlayerJoined(
        bytes32 indexed gameCode,
        address indexed player2,
        uint256 wagerAmount
    );
    event MatchResolved(
        bytes32 indexed gameCode,
        address indexed winner,
        uint256 winnerPayout,
        uint256 adminFee
    );
    event DrawResolved(
        bytes32 indexed gameCode,
        address indexed player1,
        address indexed player2,
        uint256 refundEach
    );
    event Refunded(
        bytes32 indexed gameCode,
        address player1,
        address player2,
        uint256 wagerAmount
    );

    modifier onlyCoordinator() {
        require(msg.sender == coordinator, "only coordinator");
        _;
    }

    constructor() {
        coordinator = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Player-facing deposit functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Player1 creates a match by sending ETH as their wager.
     * @param gameCode  keccak256 hash of the human-readable game code
     */
    function createMatch(bytes32 gameCode) external payable {
        require(matches[gameCode].createdAt == 0, "match already exists");
        require(msg.value > 0, "wager must be > 0");

        matches[gameCode] = Match({
            gameCode:    gameCode,
            player1:     msg.sender,
            player2:     address(0),
            wagerAmount: msg.value,
            totalStaked: msg.value,
            createdAt:   block.timestamp,
            status:      MatchStatus.PENDING,
            winner:      address(0)
        });

        emit MatchCreated(gameCode, msg.sender, msg.value);
    }

    /**
     * @notice Player2 joins an existing match by sending the exact wager amount.
     * @param gameCode  Same bytes32 used in createMatch
     */
    function joinMatch(bytes32 gameCode) external payable {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0,                    "match not found");
        require(m.status == MatchStatus.PENDING,     "match not pending");
        require(m.player2 == address(0),             "match already has 2 players");
        require(msg.sender != m.player1,             "cannot join own match");
        require(msg.value == m.wagerAmount,          "must send exact wager amount");

        m.player2     = msg.sender;
        m.status      = MatchStatus.ACTIVE;
        m.totalStaked += msg.value;

        emit PlayerJoined(gameCode, msg.sender, msg.value);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Coordinator-gated resolution
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Coordinator resolves the match.
     *         winner == DRAW → each player gets their wager back (no fee).
     *         winner == player address → winner gets 95%, coordinator gets 5%.
     */
    function resolveMatch(bytes32 gameCode, address winner) external onlyCoordinator {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0,                    "match not found");
        require(m.status == MatchStatus.ACTIVE,      "match not active");
        require(
            winner == DRAW || winner == m.player1 || winner == m.player2,
            "invalid winner address"
        );

        m.status = MatchStatus.RESOLVED;
        m.winner = winner;

        if (winner == DRAW) {
            _sendETH(m.player1, m.wagerAmount);
            _sendETH(m.player2, m.wagerAmount);
            emit DrawResolved(gameCode, m.player1, m.player2, m.wagerAmount);
        } else {
            uint256 total     = m.totalStaked;
            uint256 adminFee  = (total * ADMIN_BPS) / BPS_DENOM;
            uint256 winnerPay = total - adminFee;
            _sendETH(winner, winnerPay);
            _sendETH(coordinator, adminFee);
            emit MatchResolved(gameCode, winner, winnerPay, adminFee);
        }
    }

    /**
     * @notice Public safety valve: fully refunds deposited players after 1 hour.
     *         No admin fee on timeout refunds.
     */
    function refundAfterTimeout(bytes32 gameCode) external {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0,                        "match not found");
        require(m.status != MatchStatus.RESOLVED,        "already resolved");
        require(m.status != MatchStatus.REFUNDED,        "already refunded");
        require(block.timestamp >= m.createdAt + 1 hours, "wait 1 hour from creation");

        m.status = MatchStatus.REFUNDED;

        if (m.player1 != address(0)) _sendETH(m.player1, m.wagerAmount);
        // player2 only deposited if status reached ACTIVE
        if (m.player2 != address(0)) _sendETH(m.player2, m.wagerAmount);

        emit Refunded(gameCode, m.player1, m.player2, m.wagerAmount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View / admin helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Returns full match details.
    function getMatch(bytes32 gameCode) external view returns (Match memory) {
        return matches[gameCode];
    }

    /// @notice Transfer coordinator role.
    function setCoordinator(address newCoordinator) external onlyCoordinator {
        require(newCoordinator != address(0), "invalid address");
        coordinator = newCoordinator;
    }

    /// @notice Emergency: coordinator withdraws all ETH.
    function emergencyWithdraw() external onlyCoordinator {
        uint256 balance = address(this).balance;
        require(balance > 0, "no balance");
        _sendETH(coordinator, balance);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────────

    function _sendETH(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "ETH transfer failed");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title ChessterEscrow
 * @dev Coordinator-controlled escrow for wagered chess matches.
 *
 * Flow:
 *   1. Player approves this contract for >= wagerAmount on the chosen ERC-20.
 *   2. Backend coordinator calls createMatch() — pulls tokens from player1.
 *   3. Player2 approves this contract, backend calls joinMatch() — pulls from player2.
 *   4. After the game ends, backend calls resolveMatch() to pay out.
 *
 * Payout:  winner 95%  |  coordinator (admin) 5%
 * Draw:    each player gets their wager back  (no admin cut)
 * Timeout: anyone can call refundAfterTimeout() 1 hour after creation
 *          to fully refund deposited players (no admin cut).
 *
 * Only ERC-20 tokens are supported; use WETH for ETH-denominated wagers.
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
        address token;
        uint256 wagerAmount; // per-player stake
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
        address indexed token,
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
    // Core escrow functions (all coordinator-gated except refundAfterTimeout)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Coordinator creates a match and pulls the wager from player1.
     * @dev    player1 must have called token.approve(address(this), wagerAmount)
     *         before the coordinator calls this.
     * @param gameCode     keccak256 hash of the human-readable game code
     * @param player1      Creator's wallet address (the one who approved)
     * @param token        ERC-20 contract address (use WETH for ETH-denominated)
     * @param wagerAmount  Amount in token base units (18-decimal assumed)
     */
    function createMatch(
        bytes32 gameCode,
        address player1,
        address token,
        uint256 wagerAmount
    ) external onlyCoordinator {
        require(matches[gameCode].createdAt == 0, "match already exists");
        require(wagerAmount > 0, "wager must be > 0");
        require(token != address(0), "use an ERC-20 token (WETH for ETH)");
        require(player1 != address(0), "invalid player1");

        bool ok = IERC20(token).transferFrom(player1, address(this), wagerAmount);
        require(ok, "token pull from player1 failed - did player1 approve?");

        matches[gameCode] = Match({
            gameCode:    gameCode,
            player1:     player1,
            player2:     address(0),
            token:       token,
            wagerAmount: wagerAmount,
            totalStaked: wagerAmount,
            createdAt:   block.timestamp,
            status:      MatchStatus.PENDING,
            winner:      address(0)
        });

        emit MatchCreated(gameCode, player1, token, wagerAmount);
    }

    /**
     * @notice Coordinator joins the match on behalf of player2 and pulls their wager.
     * @dev    player2 must have called token.approve(address(this), wagerAmount)
     *         before the coordinator calls this.
     * @param gameCode  Same bytes32 used in createMatch
     * @param player2   Joiner's wallet address (the one who approved)
     */
    function joinMatch(bytes32 gameCode, address player2) external onlyCoordinator {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0,            "match not found");
        require(m.status == MatchStatus.PENDING, "match not pending");
        require(m.player2 == address(0),     "match already has 2 players");
        require(player2 != address(0),        "invalid player2");
        require(player2 != m.player1,         "cannot join own match");

        bool ok = IERC20(m.token).transferFrom(player2, address(this), m.wagerAmount);
        require(ok, "token pull from player2 failed - did player2 approve?");

        m.player2     = player2;
        m.status      = MatchStatus.ACTIVE;
        m.totalStaked += m.wagerAmount;

        emit PlayerJoined(gameCode, player2, m.wagerAmount);
    }

    /**
     * @notice Coordinator resolves the match.
     *         winner == DRAW → each player gets their wager back (no fee).
     *         winner == player address → winner gets 95%, coordinator gets 5%.
     */
    function resolveMatch(bytes32 gameCode, address winner) external onlyCoordinator {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0,             "match not found");
        require(m.status == MatchStatus.ACTIVE, "match not active");
        require(
            winner == DRAW || winner == m.player1 || winner == m.player2,
            "invalid winner address"
        );

        m.status = MatchStatus.RESOLVED;
        m.winner = winner;

        if (winner == DRAW) {
            IERC20(m.token).transfer(m.player1, m.wagerAmount);
            IERC20(m.token).transfer(m.player2, m.wagerAmount);
            emit DrawResolved(gameCode, m.player1, m.player2, m.wagerAmount);
        } else {
            uint256 total      = m.totalStaked;
            uint256 adminFee   = (total * ADMIN_BPS) / BPS_DENOM;
            uint256 winnerPay  = total - adminFee;
            IERC20(m.token).transfer(winner, winnerPay);
            IERC20(m.token).transfer(coordinator, adminFee);
            emit MatchResolved(gameCode, winner, winnerPay, adminFee);
        }
    }

    /**
     * @notice Public safety valve: fully refunds deposited players after 1 hour.
     *         No admin fee on timeout refunds.
     */
    function refundAfterTimeout(bytes32 gameCode) external {
        Match storage m = matches[gameCode];
        require(m.createdAt != 0,                       "match not found");
        require(m.status != MatchStatus.RESOLVED,        "already resolved");
        require(m.status != MatchStatus.REFUNDED,        "already refunded");
        require(block.timestamp >= m.createdAt + 1 hours, "wait 1 hour from creation");

        m.status = MatchStatus.REFUNDED;

        if (m.player1 != address(0)) {
            IERC20(m.token).transfer(m.player1, m.wagerAmount);
        }
        // player2 only deposited if status reached ACTIVE
        if (m.player2 != address(0)) {
            IERC20(m.token).transfer(m.player2, m.wagerAmount);
        }

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

    /// @notice Emergency: coordinator withdraws ERC-20 tokens.
    function emergencyWithdraw(address token) external onlyCoordinator {
        uint256 balance = IERC20(token).balanceOf(address(this));
        require(balance > 0, "no balance");
        IERC20(token).transfer(coordinator, balance);
    }
}

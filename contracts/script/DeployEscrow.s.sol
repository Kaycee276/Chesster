// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "forge-std/Script.sol";
import "../src/ChessterEscrow.sol";

contract DeployEscrow is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        ChessterEscrow escrow = new ChessterEscrow();
        vm.stopBroadcast();

        console.log("ChessterEscrow deployed to:", address(escrow));
    }
}

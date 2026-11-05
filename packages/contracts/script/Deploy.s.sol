// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AaveV3Polygon, AaveV3PolygonAssets} from "aave-address-book/AaveV3Polygon.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {GroupKitty} from "../src/GroupKitty.sol";
import {IAavePool} from "../src/interfaces/IKittora.sol";

/// Deploys PocketVault + GroupKitty to Polygon PoS (137) and wires them.
/// MAINNET: run only after Maris approves (brief §11). Addresses come from the bgd-labs aave-address-book.
/// Env: ATTESTER_ADDRESS, BURN_ADDRESS (default 0x…dEaD), CLAIM_DELAY_SECONDS (default 3600).
/// forge script script/Deploy.s.sol --rpc-url $POLYGON_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast --verify
contract Deploy is Script {
    function run() external returns (PocketVault vault, GroupKitty gk) {
        require(block.chainid == 137, "Polygon PoS only");
        address attester = vm.envAddress("ATTESTER_ADDRESS");
        address burn = vm.envOr("BURN_ADDRESS", address(0x000000000000000000000000000000000000dEaD));
        uint64 claimDelay = uint64(vm.envOr("CLAIM_DELAY_SECONDS", uint256(3600)));

        vm.startBroadcast();
        vault = new PocketVault(
            IERC20(AaveV3PolygonAssets.USDT0_UNDERLYING),
            IERC20(AaveV3PolygonAssets.USDT0_A_TOKEN),
            IAavePool(address(AaveV3Polygon.POOL)),
            attester,
            burn,
            claimDelay
        );
        gk = new GroupKitty(IERC20(AaveV3PolygonAssets.USDT0_UNDERLYING), address(vault));
        vault.setGroupKitty(address(gk));
        vm.stopBroadcast();

        console2.log("PocketVault", address(vault));
        console2.log("GroupKitty ", address(gk));
    }
}

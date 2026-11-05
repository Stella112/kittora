// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Gate 0 / S6: Aave V3 Polygon USDT supply + withdraw from a contract, on a Polygon mainnet fork.
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AaveV3Polygon, AaveV3PolygonAssets} from "aave-address-book/AaveV3Polygon.sol";

contract AaveUser {
    using SafeERC20 for IERC20;
    IERC20 constant USDT = IERC20(AaveV3PolygonAssets.USDT0_UNDERLYING);

    function supply(uint256 amt) external {
        USDT.forceApprove(address(AaveV3Polygon.POOL), amt);
        AaveV3Polygon.POOL.supply(address(USDT), amt, address(this), 0);
    }

    function withdraw(uint256 amt, address to) external returns (uint256) {
        return AaveV3Polygon.POOL.withdraw(address(USDT), amt, to);
    }
}

contract AaveForkTest is Test {
    IERC20 constant USDT = IERC20(AaveV3PolygonAssets.USDT0_UNDERLYING);
    IERC20 constant AUSDT = IERC20(AaveV3PolygonAssets.USDT0_A_TOKEN);

    function setUp() public {
        vm.createSelectFork(vm.envOr("POLYGON_RPC_URL", string("https://polygon-bor-rpc.publicnode.com")));
    }

    function test_supplyAccruesAndWithdraws() public {
        AaveUser u = new AaveUser();
        deal(address(USDT), address(u), 10e6);
        u.supply(10e6);
        assertApproxEqAbs(AUSDT.balanceOf(address(u)), 10e6, 1);

        vm.warp(block.timestamp + 30 days);
        uint256 grown = AUSDT.balanceOf(address(u));
        assertGt(grown, 10e6, "no yield accrued");
        emit log_named_uint("aUSDT after 30d (6dp)", grown);

        uint256 out = u.withdraw(type(uint256).max, address(this));
        assertEq(out, grown);
        assertEq(USDT.balanceOf(address(this)), grown);
        assertEq(AUSDT.balanceOf(address(u)), 0);
    }
}

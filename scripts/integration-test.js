// script for testing a full deployment, including gnosis multisig interaction on local fork

const { ethers } = require("hardhat");
const hre = require("hardhat")
const { addresses } = require("../lib/index")
const {time} = require("@openzeppelin/test-helpers")
const {check, checkIncreased, sudo, toETH, waitDays, resetFork} = require("./helpers")
const SIX_MONTHS_IN_SEC = "15552000";

async function main() {
  let networkName = hre.network.name
  if (networkName != "hardhat") {
    throw "This script can only run in hardhat network at this time"
  }

  const getBlock = async () => await hre.ethers.provider.getBlockNumber()

  // transfer 10 ETH to multisig
  let signer = (await hre.ethers.getSigners())[0];
  let signer2 = (await hre.ethers.getSigners())[1];
  await signer.sendTransaction({to: addresses.multisigAddress, value: toETH("10")}) // 10 ETH
  senderAddress = await signer.getAddress()
  senderAddress2 = await signer2.getAddress()

  console.log(`########## PERFORMING MOCK DEPLOYMENT TO ${networkName} ##########`)
  console.log(`Using sender address ${senderAddress}`)

  let idleToken = addresses.networks.mainnet.idle;
  const TokenGeyser = await hre.ethers.getContractFactory("TokenGeyser", signer);
  const MockERC20 = await hre.ethers.getContractFactory("MockERC20", signer);
  const idleTokenContract = await hre.ethers.getContractAt("MockERC20", idleToken);
  let mockLP = await MockERC20.deploy(toETH('10000'));
  await mockLP.deployed()
  await mockLP.transfer(addresses.multisigAddress, toETH('1000'));

  console.log(`Using the following address for LP Token: ${mockLP.address}`)
  console.log(`Using the following address for idle Token: ${idleToken}`)

  let geyser = await TokenGeyser.deploy(
    mockLP.address,
    idleToken,
    "10000", // maxUnlockSchedules; same value as ampleforth
    "33", // starting bonus [boosted to 3x over bonus period duration]
    "10368000", // Bonus period in seconds [4 months in seconds]
    "1000000" // initialSharesPerToken; same value as ampleforth
  );

  await geyser.deployed()
  console.log(`Geyser created: ${geyser.address}`)
  console.log(`Transfering ownership to multisig: ${addresses.multisigAddress}`)
  await geyser.transferOwnership(addresses.multisigAddress)
  console.log(`Contract deployment '${networkName}' complete`)
  console.log('###################');
  // from here the multisigAddress must create the funding schedule
  // done by calling `lockTokens`

  const lock = async (amount) => {
    let [multiSigGeyser, multiSigGeyserSigner] = await sudo(addresses.multisigAddress, geyser);
    console.log(`Approving geyser contract to spend ${amount.toString()} of IDLE`);
    const idleContract = await hre.ethers.getContractAt("MockERC20", idleToken, multiSigGeyserSigner);
    await idleContract.approve(geyser.address, ethers.constants.MaxUint256) // signed by multisig
    console.log(`Locking ${amount} IDLE for 6 months`)
    await multiSigGeyser.lockTokens(amount, SIX_MONTHS_IN_SEC) // Test with 1000 IDLE
  };

  const stakeForDays = async (usr, amount, days) => {
    // give user some LP shares
    const [mockLPSigned, mockLPSigner] = await sudo(signer.address, mockLP);
    await mockLPSigned.transfer(usr, amount);
    // Approve geyser to transfer LP shares
    const [mockLPSignedUsr] = await sudo(usr, mockLP);
    await mockLPSignedUsr.approve(geyser.address, ethers.constants.MaxUint256);
    // Stake, wait, unstake
    let [usrGeyser, usrGeyserSigner] = await sudo(usr, geyser);
    console.log(`Stake ${amount} IDLE for ${days} days`)
    await usrGeyser.stake(amount, "0x") // Test with 1000 IDLE
    if (days > 0) {
      await waitDays(days);
      console.log(`Unstaking ${amount} LP tokens`);
      await usrGeyser.unstake(amount, "0x");
    }
  };

  const unstake = async (usr, amount, expectedGains) => {
    const [geyserSigned] = await sudo(usr, geyser);
    let initialBalance = await idleTokenContract.balanceOf(usr)
    console.log(`Unstaking ${amount} LP tokens`);
    await geyserSigned.unstake(amount, "0x");
    let finalBalance = await idleTokenContract.balanceOf(usr)
    check(finalBalance.sub(initialBalance), expectedGains);
  }

  const singleUserTest = async (usr, amount, days, expectedGains, resetBlock) => {
    let initialBalance = await idleTokenContract.balanceOf(usr)
    await stakeForDays(usr, amount, days);
    let finalBalance = await idleTokenContract.balanceOf(usr)
    check(finalBalance.sub(initialBalance), expectedGains);
    if (resetBlock) {
      await resetFork(resetBlock);
    }
  };

  // Lock tokens in staking contract
  await lock(toETH('600'));
  let blockNumber = await getBlock();
  console.log('Starting test...')

  // Test With geyser single user
  // await singleUserTest(addresses.multisigAddress, toETH('100'), 30, toETH('333'), blockNumber); // 49 (49000056712962962962)
  // await singleUserTest(addresses.multisigAddress, toETH('100'), 60, toETH('333'), blockNumber); // 132 (132000076388888888888)
  // await singleUserTest(addresses.multisigAddress, toETH('100'), 90, toETH('333'), blockNumber); // 249 (249000096064814814814)
  // await singleUserTest(addresses.multisigAddress, toETH('100'), 120, toETH('600'), blockNumber); // 400 (400000115740740740740)
  // await singleUserTest(addresses.multisigAddress, toETH('100'), 150, toETH('600'), blockNumber); // 500 (500000115740740740740)
  // await singleUserTest(addresses.multisigAddress, toETH('100'), 180, toETH('600'), blockNumber); // 600

  // Test with multiple users and multiple deposits
  await singleUserTest(senderAddress, toETH('100'), 0, toETH('0'));
  await singleUserTest(senderAddress2, toETH('100'), 0, toETH('0'));

  await waitDays(30);

  // should be around 24.5 so this will fails but that's enough to get the idea
  await unstake(senderAddress, toETH('100'), toETH('24.5'))
  await unstake(senderAddress2, toETH('100'), toETH('24.5'))

  // TODO Test with single user and multiple deposits
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

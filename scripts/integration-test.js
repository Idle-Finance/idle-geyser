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
  let signer3 = (await hre.ethers.getSigners())[2];
  let signer4 = (await hre.ethers.getSigners())[3];
  const senderAddress = await signer.getAddress()
  const senderAddress2 = await signer2.getAddress()
  const senderAddress3 = await signer3.getAddress()
  const senderAddress4 = await signer4.getAddress()
  await signer.sendTransaction({to: addresses.multisigAddress, value: toETH("10")}) // 10 ETH

  console.log(`########## PERFORMING MOCK DEPLOYMENT TO ${networkName} ##########`)
  console.log(`Using sender address ${senderAddress}`)

  let idleToken = addresses.networks.mainnet.idle;
  console.log(`Using the following address for idle Token: ${idleToken}`);

  const MasterChefTokenizer = await hre.ethers.getContractFactory("MasterChefTokenizer", signer);
  const TokenGeyser = await hre.ethers.getContractFactory("TokenGeyser", signer);
  const idleTokenContract = await hre.ethers.getContractAt("IERC20", idleToken);

  const sushiLP = await hre.ethers.getContractAt("IERC20", addresses.networks.mainnet.sushiLPToken);
  let mockLP = sushiLP;
  const [mockLPSigned, mockLPSigner] = await sudo(addresses.networks.mainnet.userWithSushiLP, mockLP);
  await mockLPSigned.transfer(signer.address, toETH('100')); // 100 LP shares
  // await mockLPSigned.transfer(addresses.multisigAddress, toETH('100')); // 100 LP shares

  // const MockERC20 = await hre.ethers.getContractFactory("MockERC20", signer);
  // let mockLP = await MockERC20.deploy(toETH('10000'));
  // await mockLP.deployed()
  // await mockLP.transfer(addresses.multisigAddress, toETH('1000'));
  console.log(`Using the following address for LP Token: ${mockLP.address}`)

  let tokenizer = await MasterChefTokenizer.deploy(
    "Wrapper sushi IDLE/ETH LP",
    "wIDLESushiLP",
    addresses.networks.mainnet.sushiLPToken,
    addresses.networks.mainnet.sushiLPPid
  );
  await tokenizer.deployed();
  console.log(`Tokenizer created: ${tokenizer.address}`);

  let geyser = await TokenGeyser.deploy(
    tokenizer.address,
    idleToken,
    "10000", // maxUnlockSchedules; same value as ampleforth
    "33", // starting bonus [boosted to 3x over bonus period duration]
    "10368000", // Bonus period in seconds [4 months in seconds]
    "1000000", // initialSharesPerToken; same value as ampleforth
    mockLP.address // unwrappedStakingToken_
  );

  await geyser.deployed();
  console.log(`Geyser created: ${geyser.address}`);

  await tokenizer.transferGeyser(geyser.address)
  console.log(`Set geyser in tokenizer: ${geyser.address}`);

  console.log(`Transfering Geyser ownership to multisig: ${addresses.multisigAddress}`)
  await geyser.transferOwnership(addresses.multisigAddress)
  console.log(`Transfering Tokenizer ownership to multisig: ${addresses.multisigAddress}`)
  await tokenizer.transferOwnership(addresses.multisigAddress)
  console.log(`Contract deployment '${networkName}' complete`)
  console.log('###################');
  // from here the multisigAddress must create the funding schedule
  // done by calling `lockTokens`

  const lock = async (amount) => {
    let [multiSigGeyser, multiSigGeyserSigner] = await sudo(addresses.multisigAddress, geyser);
    console.log(`Approving geyser contract to spend ${amount.toString()} of IDLE`);
    const idleContract = await hre.ethers.getContractAt("IERC20", idleToken, multiSigGeyserSigner);
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
    await usrGeyser.wrapAndStake(amount) // Test with 1000 IDLE
    if (days > 0) {
      await waitDays(days);
      console.log(`Unstaking ${amount} LP tokens`);
      await usrGeyser.unstakeAndUnwrap(amount);
    }
  };

  const unstake = async (usr, amount, expectedGains) => {
    const [geyserSigned] = await sudo(usr, geyser);
    let initialBalance = await idleTokenContract.balanceOf(usr)
    console.log(`Unstaking ${amount} LP tokens`);
    await geyserSigned.unstakeAndUnwrap(amount);
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
  await singleUserTest(addresses.multisigAddress, toETH('10'), 30, toETH('49')); // 49 (49000056712962962962)
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 60, toETH('132'), blockNumber); // 132 (132000076388888888888)
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 90, toETH('249'), blockNumber); // 249 (249000096064814814814)
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 120, toETH('400'), blockNumber); // 400 (400000115740740740740)
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 150, toETH('500'), blockNumber); // 500 (500000115740740740740)
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 180, toETH('600'), blockNumber); // 600

  // Test with multiple users and multiple deposits
  // Test 1
  // await singleUserTest(senderAddress, toETH('100'), 0, toETH('0'));
  // await singleUserTest(senderAddress2, toETH('100'), 0, toETH('0'));
  // await waitDays(120);
  // await unstake(senderAddress, toETH('100'), toETH('200'))
  // await unstake(senderAddress2, toETH('100'), toETH('200'))

  // // Test 2
  // await singleUserTest(senderAddress, toETH('100'), 0, toETH('0'));
  // await singleUserTest(senderAddress2, toETH('100'), 0, toETH('0'));
  // await singleUserTest(senderAddress3, toETH('100'), 0, toETH('0'));
  // await singleUserTest(senderAddress4, toETH('100'), 0, toETH('0'));
  // await waitDays(30);
  // await unstake(senderAddress, toETH('100'), toETH('12.25'))
  // // await geyser.unlockTokens();
  // await unstake(senderAddress2, toETH('100'), toETH('12.25'))
  // await unstake(senderAddress3, toETH('100'), toETH('12.25'))
  // await unstake(senderAddress4, toETH('100'), toETH('12.25'))
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

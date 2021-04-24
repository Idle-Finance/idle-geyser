// script for testing a full deployment, including gnosis multisig interaction on local fork

const { ethers } = require("hardhat");
const hre = require("hardhat")
const { addresses } = require("../lib/index")
const {time} = require("@openzeppelin/test-helpers")
const {check, checkIncreased, sudo, toETH, waitDays, resetFork, checkAproximate} = require("./helpers")
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
  let sushiToken = addresses.networks.mainnet.sushi;
  console.log(`Using the following address for idle Token: ${idleToken}`);

  const MasterChefTokenizer = await hre.ethers.getContractFactory("MasterChefTokenizer", signer);
  const TokenGeyser = await hre.ethers.getContractFactory("TokenGeyser", signer);
  const idleTokenContract = await hre.ethers.getContractAt("IERC20", idleToken);
  const sushiTokenContract = await hre.ethers.getContractAt("IERC20", sushiToken);

  const sushiLP = await hre.ethers.getContractAt("IERC20", addresses.networks.mainnet.sushiLPToken);
  let mockLP = sushiLP;

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

  if (network == 'mainnet') {
    return;
  }

  const [mockLPSigned, mockLPSigner] = await sudo(addresses.networks.mainnet.userWithSushiLP, mockLP);
  await mockLPSigned.transfer(signer.address, toETH('100')); // 100 LP shares
  console.log(`Using the following address for LP Token: ${mockLP.address}`)

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
    let initialLPBalance = await mockLP.balanceOf(usr)
    await geyserSigned.unstakeAndUnwrap(amount);
    let finalBalance = await idleTokenContract.balanceOf(usr)
    let finalLPBalance = await mockLP.balanceOf(usr)
    checkAproximate(finalBalance.sub(initialBalance), expectedGains, "Expected idle gains");
    check(finalLPBalance.sub(initialLPBalance), amount, "Expected LP Token amount")
  }

  const singleUserTest = async (usr, amount, days, expectedGains, resetBlock) => {
    let initialBalance = await idleTokenContract.balanceOf(usr)
    await stakeForDays(usr, amount, days);
    let finalBalance = await idleTokenContract.balanceOf(usr)

    checkAproximate(finalBalance.sub(initialBalance), expectedGains);
    if (resetBlock) {
      await resetFork(resetBlock);
    }
  };

  // Lock tokens in staking contract
  await lock(toETH('600'));
  let blockNumber = await getBlock();
  console.log('Starting test...')

  // Test With geyser single user
  // Test that sushi in tokeniser contract can be withdrawn
  let initialSushi = await sushiTokenContract.balanceOf(tokenizer.address)
  let initialMultisigSushi = await sushiTokenContract.balanceOf(addresses.multisigAddress)
  await singleUserTest(addresses.multisigAddress, toETH('10'), 30, toETH('49')); // 49
  let afterStakingSushi = await sushiTokenContract.balanceOf(tokenizer.address)

  checkIncreased(initialSushi, afterStakingSushi, "Sushi balance increased")
  let [tokenizerSigned] = await sudo(addresses.multisigAddress, tokenizer);
  await tokenizerSigned.rescueFunds(sushiToken, addresses.multisigAddress, afterStakingSushi)
  let afterMultisigSushi = await sushiTokenContract.balanceOf(addresses.multisigAddress)
  check(afterStakingSushi, afterMultisigSushi, "Sushi transfer amounts equal")
  checkIncreased(initialMultisigSushi, afterMultisigSushi, "Sushi balance increased for multisig")


  
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 60, '132000101851851851851'); // 132
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 90, '249000128086419753085'); // 249
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 120, '400000192901234567900'); // 400
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 150, '500000154320987654320'); // 500
  // await singleUserTest(addresses.multisigAddress, toETH('10'), 180, toETH('600')); // 600

  // Test with multiple users and multiple deposits
  // Test 1
  
  await singleUserTest(senderAddress, toETH('10'), 0, toETH('0'));
  await singleUserTest(senderAddress2, toETH('5'), 0, toETH('0'));
  
  await waitDays(150);
  
  // total rewards 49 + 367.3 + 183.6 = 600
  await unstake(senderAddress, toETH('10'), toETH('367.3')); // 367.3
  await unstake(senderAddress2, toETH('5'), toETH('183.7')); // 183.7
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

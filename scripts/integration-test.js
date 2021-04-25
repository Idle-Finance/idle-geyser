// script for testing a full deployment, including gnosis multisig interaction on local fork

const { ethers } = require("hardhat");
const hre = require("hardhat")
const { addresses } = require("../lib/index")
const {expectRevert} = require("@openzeppelin/test-helpers")
const {check, checkIncreased, sudo, toETH, waitDays, resetFork, checkAproximate} = require("./helpers")
const deployContracts = require("./deploy")

const SIX_MONTHS_IN_SEC = "15552000";

async function main() {
  // let networkName = hre.network.name
  // if (networkName != "hardhat") {
  //   throw "This script can only run in hardhat network at this time"
  // }
  const [geyser, tokenizer, sushiLPToken, idleToken] = await deployContracts()

  if (network == 'mainnet') {
    return;
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

  const sushiTokenContract = await hre.ethers.getContractAt("IERC20", addresses.networks.mainnet.sushi);


  const [mockLPSigned, mockLPSigner] = await sudo(addresses.networks.mainnet.userWithSushiLP, sushiLPToken);
  await mockLPSigned.transfer(signer.address, toETH('100')); // 100 LP shares
  console.log(`Using the following address for LP Token: ${sushiLPToken.address}`)

  // ##### test tokenizer ownership
  let tokenizerOwner = await tokenizer.owner()
  console.log(`The tokenizer owner is ${tokenizerOwner}`)
  console.log(`The tokenizer geyser is ${geyser.address}`)

  const [tokenizerUserWithLP, tokenizerSigner] = await sudo(addresses.networks.mainnet.userWithSushiLP, tokenizer)
  const [tokenizerAsOwner] = await sudo(tokenizerOwner, tokenizer)
  const [tokenizerAsGeyser] = await sudo(geyser.address, tokenizer)
  let tokenizerSignerAddress = await tokenizerSigner.getAddress()
  console.log(`Wrapping 10 LP tokens as ${tokenizerSignerAddress}`)
  await mockLPSigned.approve(tokenizer.address, toETH('10'))
  await tokenizerUserWithLP.wrap(toETH('10'))

  let initialLPUserBalance = await mockLPSigned.balanceOf(tokenizerSignerAddress)

  // this call should fail because it is not the geyser
  await expectRevert(tokenizer.unwrapFor(toETH('10'), tokenizerSignerAddress), "Tokenizer: Not Geyser")
  check(await tokenizer.balanceOf(tokenizerSignerAddress), toETH('10'), "wLP balance did not decrease")
  check(await mockLPSigned.balanceOf(tokenizerSignerAddress), initialLPUserBalance, "LP balance 0")

  await expectRevert(tokenizerAsOwner.unwrapFor(toETH('10'), tokenizerSignerAddress), "Tokenizer: Not Geyser")
  check(await tokenizer.balanceOf(tokenizerSignerAddress), toETH('10'), "wLP balance did not decrease")
  check(await mockLPSigned.balanceOf(tokenizerSignerAddress), initialLPUserBalance, "LP balance is increased")

  // this call should succeed
  await tokenizerAsGeyser.unwrapFor(toETH('10'), tokenizerSignerAddress, {gasPrice: 0}) // this tx is technically not possible, but is used to demonstrate the role permission
  check(await tokenizer.balanceOf(tokenizerSignerAddress), toETH('0'), "wLP balance decreased")
  check(await mockLPSigned.balanceOf(tokenizerSignerAddress), initialLPUserBalance.add(toETH('10')), "LP balance is increased")

  const lock = async (amount) => {
    let [multiSigGeyser, multiSigGeyserSigner] = await sudo(addresses.multisigAddress, geyser);
    console.log(`Approving geyser contract to spend ${amount.toString()} of IDLE`);
    const idleContract = await hre.ethers.getContractAt("IERC20", idleToken.address, multiSigGeyserSigner);
    await idleContract.approve(geyser.address, ethers.constants.MaxUint256) // signed by multisig
    console.log(`Locking ${amount} IDLE for 6 months`)
    await multiSigGeyser.lockTokens(amount, SIX_MONTHS_IN_SEC) // Test with 1000 IDLE
  };

  const stakeForDays = async (usr, amount, days) => {
    // give user some LP shares
    const [mockLPSigned, mockLPSigner] = await sudo(signer.address, sushiLPToken);
    await mockLPSigned.transfer(usr, amount);
    // Approve geyser to transfer LP shares
    const [mockLPSignedUsr] = await sudo(usr, sushiLPToken);
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
    let initialBalance = await idleToken.balanceOf(usr)
    console.log(`Unstaking ${amount} LP tokens`);
    let initialLPBalance = await sushiLPToken.balanceOf(usr)
    await geyserSigned.unstakeAndUnwrap(amount);
    let finalBalance = await idleToken.balanceOf(usr)
    let finalLPBalance = await sushiLPToken.balanceOf(usr)
    checkAproximate(finalBalance.sub(initialBalance), expectedGains, "Expected idle gains");
    check(finalLPBalance.sub(initialLPBalance), amount, "Expected LP Token amount")
  }

  const singleUserTest = async (usr, amount, days, expectedGains, resetBlock) => {
    let initialBalance = await idleToken.balanceOf(usr)
    await stakeForDays(usr, amount, days);
    let finalBalance = await idleToken.balanceOf(usr)

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
  await tokenizerSigned.rescueFunds(addresses.networks.mainnet.sushi, addresses.multisigAddress, afterStakingSushi)
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

  // staking period 1 had ended now


  // ##### Simulate emergency withdraw on tokeniser
  let x = await sushiLPToken.balanceOf(senderAddress)
  console.log(x.toString())
  let [userTokenizerSigned] = await sudo(senderAddress, tokenizer);
  let [sushiTokenSigned] = await sudo(senderAddress, sushiLPToken);
  await sushiTokenSigned.approve(tokenizer.address, toETH('5'))
  await userTokenizerSigned.wrap(toETH('5'))
  let feeTreasuryLPBalanceInitial = await sushiLPToken.balanceOf(addresses.feeTreasury)
  console.log("Performing emergency shutdown on MasterChefTokeniser")
  await tokenizerAsOwner.emergencyShutdown(toETH('5'))
  let feeTreasuryLPBalance = await sushiLPToken.balanceOf(addresses.feeTreasury)
  check(feeTreasuryLPBalance.sub(feeTreasuryLPBalanceInitial), toETH('5'), "FeeTreasury LP balance increased")

  // simulating emergency withdraw on geyser
  console.log("Testing emergency shutdown on geyser contract")
  await lock(toETH('100'));
  await singleUserTest(senderAddress, toETH('10'), 0, toETH('0'));

  await waitDays(30);

  await unstake(senderAddress, toETH('5'), toETH('4.08')); 

  const [geyserAsOwner] = await sudo(addresses.multisigAddress, geyser);
  await geyserAsOwner.emergencyShutdown();
  let finalFeeTreasurywLPBalance = await tokenizer.balanceOf(addresses.feeTreasury)
  let finalFeeTreasuryIDLE = await idleToken.balanceOf(addresses.feeTreasury)

  check(finalFeeTreasurywLPBalance, toETH('5'), "5 wLP should be sent to feeTreasury")
  checkAproximate(finalFeeTreasuryIDLE.toString(), toETH("100").sub(toETH("4.08")), "Outstanding idle is sent to feeTreasury")

}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

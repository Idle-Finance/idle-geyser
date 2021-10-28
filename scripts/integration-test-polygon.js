// script for testing a full deployment, including gnosis multisig interaction on local fork

const { ethers } = require("hardhat");
const hre = require("hardhat")
const { addresses } = require("../lib/index")
const {expectRevert} = require("@openzeppelin/test-helpers")
const {check, checkIncreased, sudo, toETH, waitDays, resetFork, checkAproximate} = require("./helpers")
const deployContracts = require("./deploy-polygon")

const THREE_MONTHS_IN_SEC = "5184000";

async function main() {
  const [geyser, tokenizer, sushiLPToken, idleToken] = await deployContracts()
  // const tokenizer = await hre.ethers.getContractAt("MasterChefTokenizerPolygon", addresses.networks.matic.tokenizer);
  // const geyser = await hre.ethers.getContractAt("TokenGeyserPolygon", addresses.networks.matic.geyser);
  //
  // const sushiLPToken = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.sushiLPToken)
  // const idleToken = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.idle);

  const owner = await geyser.owner();
  console.log('owner', owner);
  const multisig = addresses.networks.matic.multisigAddress;
  if (owner.toLowerCase() !== multisig) {
    const [geyserOwner] = await sudo(owner, geyser);
    console.log(`Transfering Geyser ownership to multisig: ${multisig}`)
    await geyserOwner.transferOwnership(multisig)

    const [tokenizerOwner] = await sudo(owner, tokenizer);
    console.log(`Transfering Tokenizer ownership to multisig: ${multisig}`)
    await tokenizerOwner.transferOwnership(multisig)
  }

  if (network == 'matic') {
    return;
  }

  console.log('Testing...');

  const getBlock = async () => await hre.ethers.provider.getBlockNumber()

  // transfer 10 ETH to multisig
  let signer = (await hre.ethers.getSigners())[0];
  let signer2 = (await hre.ethers.getSigners())[1];
  let signer3 = (await hre.ethers.getSigners())[2];
  let signer4 = (await hre.ethers.getSigners())[3];
  let signer5 = (await hre.ethers.getSigners())[3];
  const senderAddress = await signer.getAddress()
  const senderAddress2 = await signer2.getAddress()
  const senderAddress3 = await signer3.getAddress()
  const senderAddress4 = await signer4.getAddress()
  const senderAddress5 = await signer4.getAddress()

  const slpAmount = toETH('100');
  const slpMinAmount = toETH('10');
  // Give some SLP from MiniChef to userWithSushiLP
  const masterchef = "0x0769fd68dfb93167989c6f7254cd0d766fb2841f";
  await hre.network.provider.send("hardhat_setBalance", [masterchef, "0xffffffffffffffff"]);
  const [slpContract] = await sudo(masterchef, sushiLPToken);
  await slpContract.transfer(addresses.networks.matic.userWithSushiLP, slpAmount)
  // set eth balance for multisig and userWithSushiLP
  await hre.network.provider.send("hardhat_setBalance", [multisig, "0xffffffffffffffff"]);
  await hre.network.provider.send("hardhat_setBalance", [addresses.networks.matic.userWithSushiLP, "0xffffffffffffffff"]);

  const sushiTokenContract = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.sushi);
  const [mockLPSigned, mockLPSigner] = await sudo(addresses.networks.matic.userWithSushiLP, sushiLPToken);
  // console.log({initialLPUserBalance: (await mockLPSigned.balanceOf(addresses.networks.matic.userWithSushiLP)).toString()});

  // give 10 SLP from userWithSushiLP to first signer
  await mockLPSigned.transfer(signer.address, slpAmount.sub(slpMinAmount)); // 90 LP shares
  console.log(`Using the following address for LP Token: ${sushiLPToken.address}`)

  // ##### test tokenizer ownership
  let tokenizerOwner = await tokenizer.owner()
  console.log(`The tokenizer owner is ${tokenizerOwner}`)
  console.log(`The tokenizer geyser is ${geyser.address}`)

  const [tokenizerUserWithLP, tokenizerSigner] = await sudo(addresses.networks.matic.userWithSushiLP, tokenizer)
  const [tokenizerAsOwner] = await sudo(tokenizerOwner, tokenizer)
  const [tokenizerAsGeyser] = await sudo(geyser.address, tokenizer)
  let tokenizerSignerAddress = await tokenizerSigner.getAddress()
  await hre.network.provider.send("hardhat_setBalance", [tokenizerSignerAddress, "0xffffffffffffffff"]);
  await hre.network.provider.send("hardhat_setBalance", [geyser.address, "0xffffffffffffffff"]);
  // console.log({initialLPUserBalance: (await mockLPSigned.balanceOf(tokenizerSignerAddress)).toString()});
  console.log(`Wrapping 10 LP tokens as ${tokenizerSignerAddress}`)
  await mockLPSigned.approve(tokenizer.address, slpMinAmount)
  await tokenizerUserWithLP.wrap(slpMinAmount)

  let initialLPUserBalance = await mockLPSigned.balanceOf(tokenizerSignerAddress)

  // this call should fail because it is not the geyser
  await expectRevert(tokenizer.unwrapFor(slpMinAmount, tokenizerSignerAddress), "Tokenizer: Not Geyser")
  check(await tokenizer.balanceOf(tokenizerSignerAddress), slpMinAmount, "wLP balance did not decrease")
  check(await mockLPSigned.balanceOf(tokenizerSignerAddress), initialLPUserBalance, "LP balance 0")

  await expectRevert(tokenizerAsOwner.unwrapFor(slpMinAmount, tokenizerSignerAddress), "Tokenizer: Not Geyser")
  check(await tokenizer.balanceOf(tokenizerSignerAddress), slpMinAmount, "wLP balance did not decrease")
  check(await mockLPSigned.balanceOf(tokenizerSignerAddress), initialLPUserBalance, "LP balance is increased")

  // this call should succeed
  await tokenizerAsGeyser.unwrapFor(slpMinAmount, tokenizerSignerAddress, {gasPrice: 1e9}) // this tx is technically not possible, but is used to demonstrate the role permission

  check(await tokenizer.balanceOf(tokenizerSignerAddress), toETH('0'), "wLP balance decreased")
  check(await mockLPSigned.balanceOf(tokenizerSignerAddress), initialLPUserBalance.add(slpMinAmount), "LP balance is increased")
  // console.log({sushiBal: (await sushiTokenContract.balanceOf(tokenizer.address)).toString()});

  const lock = async (amount) => {
    let [multiSigGeyser, multiSigGeyserSigner] = await sudo(multisig, geyser);
    console.log(`Approving geyser contract to spend ${amount.toString()} of IDLE`);
    const idleContract = await hre.ethers.getContractAt("IERC20", idleToken.address, multiSigGeyserSigner);
    await idleContract.approve(geyser.address, ethers.constants.MaxUint256) // signed by multisig
    console.log(`Locking ${amount} IDLE for 3 months`)
    await multiSigGeyser.lockTokens(amount, THREE_MONTHS_IN_SEC) // Test with 1000 IDLE
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
    console.log(`Stake ${amount} IDLE for ${days} days usr ${usr}`)
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
    console.log(`#### Unstaking ${amount} LP tokens for ${usr}`);
    let initialLPBalance = await sushiLPToken.balanceOf(usr)
    await geyserSigned.unstakeAndUnwrap(amount);
    let finalBalance = await idleToken.balanceOf(usr)
    let finalLPBalance = await sushiLPToken.balanceOf(usr)
    checkAproximate(finalBalance.sub(initialBalance), expectedGains, "Expected idle gains");
    check(finalLPBalance.sub(initialLPBalance), amount, "Expected LP Token amount")
  }

  const singleUserTest = async (usr, amount, days, expectedGains, resetBlock) => {
    console.log('##### Test for ', usr);
    let initialBalance = await idleToken.balanceOf(usr)
    await stakeForDays(usr, amount, days);
    let finalBalance = await idleToken.balanceOf(usr)

    checkAproximate(finalBalance.sub(initialBalance), expectedGains);
    if (resetBlock) {
      await resetFork(resetBlock);
    }
  };

  // Lock tokens in staking contract
  await lock(toETH('300'));
  console.log('Starting test...')

  // Test With geyser single user
  // Test that sushi in tokeniser contract can be withdrawn
  let initialSushi = await sushiTokenContract.balanceOf(tokenizer.address)
  let initialMultisigSushi = await sushiTokenContract.balanceOf(multisig)
  await singleUserTest(multisig, toETH('1'), 30, toETH('98')); // 98
  let afterStakingSushi = await sushiTokenContract.balanceOf(tokenizer.address)

  checkIncreased(initialSushi, afterStakingSushi, "Sushi balance increased")
  let [tokenizerSigned] = await sudo(multisig, tokenizer);
  await tokenizerSigned.rescueFunds(addresses.networks.matic.sushi, multisig, afterStakingSushi)
  let afterMultisigSushi = await sushiTokenContract.balanceOf(multisig)
  check(afterStakingSushi, afterMultisigSushi, "Sushi transfer amounts equal")
  checkIncreased(initialMultisigSushi, afterMultisigSushi, "Sushi balance increased for multisig")

  // await singleUserTest(multisig, toETH('10'), 60, '132000101851851851851'); // 132
  // await singleUserTest(multisig, toETH('10'), 90, '249000128086419753085'); // 249
  // await singleUserTest(multisig, toETH('10'), 120, '400000192901234567900'); // 400
  // await singleUserTest(multisig, toETH('10'), 150, '500000154320987654320'); // 500
  // await singleUserTest(multisig, toETH('10'), 180, toETH('600')); // 600

  // Test with multiple users and multiple deposits
  // Test 1
  await singleUserTest(senderAddress, toETH('10'), 0, toETH('0'));
  await singleUserTest(senderAddress2, toETH('5'), 0, toETH('0'));

  await waitDays(75);

  // total rewards 99 + 134 + 67 = 300
  await unstake(senderAddress, toETH('10'), toETH('134'));
  await unstake(senderAddress2, toETH('5'), toETH('67'));

  // staking period 1 had ended now

  // ##### Simulate emergency withdraw on tokeniser
  let x = await sushiLPToken.balanceOf(senderAddress)
  // console.log(x.toString())
  let [userTokenizerSigned] = await sudo(senderAddress, tokenizer);
  let [sushiTokenSigned] = await sudo(senderAddress, sushiLPToken);
  await sushiTokenSigned.approve(tokenizer.address, toETH('5'))
  await userTokenizerSigned.wrap(toETH('5'))
  let feeTreasuryLPBalanceInitial = await sushiLPToken.balanceOf(multisig)
  console.log("Performing emergency shutdown on MasterChefTokeniser")
  await tokenizerAsOwner.emergencyShutdown(toETH('5'))
  let feeTreasuryLPBalance = await sushiLPToken.balanceOf(multisig)
  check(feeTreasuryLPBalance.sub(feeTreasuryLPBalanceInitial), toETH('5'), "FeeTreasury LP balance increased")

  // simulating emergency withdraw on geyser
  console.log("Testing emergency shutdown on geyser contract")
  await lock(toETH('50'));

  await singleUserTest(senderAddress, toETH('2'), 0, toETH('0'));
  await waitDays(30);

  await unstake(senderAddress, toETH('1'), toETH('8.16'));

  let initialFeeTreasuryIDLE = await idleToken.balanceOf(multisig)
  const [geyserAsOwner] = await sudo(multisig, geyser);
  await geyserAsOwner.emergencyShutdown();
  let finalFeeTreasurywLPBalance = await tokenizer.balanceOf(multisig)
  let finalFeeTreasuryIDLE = await idleToken.balanceOf(multisig)

  check(finalFeeTreasurywLPBalance, toETH('1'), "1 wLP should be sent to feeTreasury")
  checkAproximate(finalFeeTreasuryIDLE.toString(), initialFeeTreasuryIDLE.add(toETH("8.16")), "Outstanding idle is sent to feeTreasury")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

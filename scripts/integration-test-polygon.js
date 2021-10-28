// script for testing a full deployment, including gnosis multisig interaction on local fork

const { ethers } = require("hardhat");
const hre = require("hardhat")
const { addresses } = require("../lib/index")
const {expectRevert} = require("@openzeppelin/test-helpers")
const {check, checkIncreased, sudo, toETH, waitDays, resetFork, checkAproximate} = require("./helpers")
const deployContracts = require("./deploy-polygon")

const THREE_MONTHS_IN_SEC = "7776000";

async function main() {
  let geyser;
  let tokenizer;
  let sushiLPToken;
  let idleToken;

  if (addresses.networks.matic.geyser) {
    tokenizer = await hre.ethers.getContractAt("MasterChefTokenizerPolygon", addresses.networks.matic.tokenizer);
    geyser = await hre.ethers.getContractAt("TokenGeyserPolygon", addresses.networks.matic.geyser);
    sushiLPToken = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.sushiLPToken)
    idleToken = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.idle);
  } else {
    console.log('#### Deploying Geyser...')
    [geyser, tokenizer, sushiLPToken, idleToken] = await deployContracts();
  }

  const owner = await geyser.owner();
  console.log('owner', owner);
  const multisig = addresses.networks.matic.multisigAddress;
  if (owner.toLowerCase() !== multisig.toLowerCase()) {
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

  const getBlock = async () => await hre.ethers.provider.getBlockNumber()
  console.log('Testing...');


  console.log('Block: ', await getBlock());

  const masterchef = addresses.networks.matic.masterchef;
  const userWithSushiLP = addresses.networks.matic.userWithSushiLP;
  let signer = (await hre.ethers.getSigners())[0];
  let signer2 = (await hre.ethers.getSigners())[1];
  const senderAddress = await signer.getAddress()
  const senderAddress2 = await signer2.getAddress()

  // set eth balance for multisig, masterchef and userWithSushiLP
  await hre.network.provider.send("hardhat_setBalance", [masterchef, "0xffffffffffffffff"]);
  await hre.network.provider.send("hardhat_setBalance", [multisig, "0xffffffffffffffff"]);
  await hre.network.provider.send("hardhat_setBalance", [userWithSushiLP, "0xffffffffffffffff"]);

  const slpAmount = toETH('0.20');
  const slpMinAmount = toETH('0.01');

  // Give slpAmount of SLP from MiniChef to userWithSushiLP
  const [slpContract] = await sudo(masterchef, sushiLPToken);
  // await slpContract.transfer(userWithSushiLP, slpAmount)

  // Get sushi contract
  const sushiTokenContract = await hre.ethers.getContractAt("IERC20", addresses.networks.matic.sushi);
  // Get SLP contract as userWithSushiLP
  const [mockLPSigned, mockLPSigner] = await sudo(userWithSushiLP, sushiLPToken);

  // Give all but slpMinAmount of SLP from userWithSushiLP to first signer
  await mockLPSigned.transfer(signer.address, slpAmount.sub(slpMinAmount)); // 80 LP shares
  console.log(`Using the following address for LP Token: ${sushiLPToken.address}`)

  // Test tokenizer ownership
  let tokenizerOwner = await tokenizer.owner()
  console.log(`The tokenizer owner is ${tokenizerOwner}`)
  console.log(`The tokenizer geyser is ${geyser.address}`)

  // get MasterChefTokeniser as userWithSushiLP
  const [tokenizerUserWithLP, tokenizerSigner] = await sudo(userWithSushiLP, tokenizer)
  // get MasterChefTokeniser as tokenizerOwner
  const [tokenizerAsOwner] = await sudo(tokenizerOwner, tokenizer)
  // get MasterChefTokeniser as Geyser
  const [tokenizerAsGeyser] = await sudo(geyser.address, tokenizer)
  let tokenizerSignerAddress = await tokenizerSigner.getAddress()

  await hre.network.provider.send("hardhat_setBalance", [tokenizerSignerAddress, "0xffffffffffffffff"]);
  await hre.network.provider.send("hardhat_setBalance", [geyser.address, "0xffffffffffffffff"]);

  console.log(`Wrapping LP tokens as ${tokenizerSignerAddress}`)
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
  console.log({sushiBal: (await sushiTokenContract.balanceOf(tokenizer.address)).toString()});

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
    console.log({initialLPBalance: initialLPBalance.toString()})
    console.log({initialWLPBal: (await tokenizerUserWithLP.balanceOf(geyser.address)).toString()})
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
    // if (resetBlock) {
    //   await resetFork(resetBlock);
    // }
  };

  // Lock tokens in staking contract
  await lock(toETH('300'));
  console.log('Starting test...')

  // Test With geyser single user
  // Test that sushi in tokeniser contract can be withdrawn
  let initialSushi = await sushiTokenContract.balanceOf(tokenizer.address)
  let initialMultisigSushi = await sushiTokenContract.balanceOf(multisig)

  // NOTE: rationale for bonus.
  // In the first non-bonus period rewards are cutted by the `startBonus`
  // (eg if start bonus 33% and 3 months prog with 2 month bonus, then first month are reduced by 33%)
  // from day 30 to day 60 rewards are reduced linearly from 33% of day 30 to 0% of day 60
  // after day 60 rewards are not reduced

  await singleUserTest(multisig, toETH('0.01'), 30, toETH('67'));
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
  await singleUserTest(senderAddress, toETH('0.02'), 0, toETH('0'));
  await singleUserTest(senderAddress2, toETH('0.01'), 0, toETH('0'));

  await waitDays(60);

  // total rewards 66 + 156 + 78 = 300
  await unstake(senderAddress, toETH('0.02'), toETH('156'));
  await unstake(senderAddress2, toETH('0.01'), toETH('78'));

  // staking period 1 had ended now

  // ##### Simulate emergency withdraw on tokeniser
  let x = await sushiLPToken.balanceOf(senderAddress)
  let [userTokenizerSigned] = await sudo(senderAddress, tokenizer);
  let [sushiTokenSigned] = await sudo(senderAddress, sushiLPToken);
  await sushiTokenSigned.approve(tokenizer.address, toETH('0.05'))
  await userTokenizerSigned.wrap(toETH('0.05'))
  let feeTreasuryLPBalanceInitial = await sushiLPToken.balanceOf(multisig)
  console.log("Performing emergency shutdown on MasterChefTokeniser")
  await tokenizerAsOwner.emergencyShutdown(toETH('0.05'))
  let feeTreasuryLPBalance = await sushiLPToken.balanceOf(multisig)
  check(feeTreasuryLPBalance.sub(feeTreasuryLPBalanceInitial), toETH('0.05'), "FeeTreasury LP balance increased")

  // simulating emergency withdraw on geyser
  console.log("Testing emergency shutdown on geyser contract")
  await lock(toETH('50'));

  await singleUserTest(senderAddress, toETH('0.02'), 0, toETH('0'));
  await waitDays(30);

  await unstake(senderAddress, toETH('0.01'), toETH('5.5'));

  let initialFeeTreasuryIDLE = await idleToken.balanceOf(multisig)
  const [geyserAsOwner] = await sudo(multisig, geyser);
  await geyserAsOwner.emergencyShutdown();
  let finalFeeTreasurywLPBalance = await tokenizer.balanceOf(multisig)
  let finalFeeTreasuryIDLE = await idleToken.balanceOf(multisig)

  check(finalFeeTreasurywLPBalance, toETH('0.01'), "1 wLP should be sent to feeTreasury")
  checkAproximate(finalFeeTreasuryIDLE.toString(), initialFeeTreasuryIDLE.add(toETH("5.5")), "Outstanding idle is sent to feeTreasury")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

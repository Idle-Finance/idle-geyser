# IDLE LP Staking Geyser 🚀
Contract implementation code for the idle LP staking geyser.

## Contracts
The contracts in this repo have been forked from [Ampleforth Token Geyser repo](https://github.com/ampleforth/token-geyser/). This repo was developed using hard hats, to compile the contacts run `npx hardhat compile`

### MasterChef Tokenizer
The MasterChefTokenizer contract wraps SushiLP tokens into the Sushi MasterChef staking contract.
Each wrappedSushiLP token (wSLP) represents a token staked in sushi. These wrapped tokens are then used for staking within the geyser.

### Token Geyser
The ampleforth token geyser implementation. 

The make the staking experience gas efficient, the tokenizer will automatically wrap and unwrap LP tokens to the geyser through two new methods on the geyser.

`wrapAndStake(uint256 amount)` and `unstakeAndUnwrap(uint256 amount)`.

Helper functions have also been added to support the permit pattern

`permitWrapAndStakeUnlimited(...)` and `permitWrapAndStake(...)`

## Integration tests
The integration tests for this repo are stored under
`./scripts/integration-test.js`

to run the tests run `npx hardhat run ./scripts/integation-test.js`

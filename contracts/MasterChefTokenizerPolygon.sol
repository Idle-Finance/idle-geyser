pragma solidity 0.5.17;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20Detailed.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

interface IMasterChef {
  function deposit(uint256 _pid, uint256 _amount, address _to) external;
  function withdraw(uint256 _pid, uint256 _amount, address _to) external;
  function harvest(uint256 pid, address to) external;
  function withdrawAndHarvest(uint256 pid, uint256 amount, address to) external;
}

contract MasterChefTokenizerPolygon is Ownable, ERC20, ERC20Detailed {
  using SafeERC20 for IERC20;
  using SafeMath for uint256;

  address public token; // sushi LP share
  address public masterChef;
  uint256 public pid;
  address private _geyser;

  constructor(
    string memory _name, // eg. IdleDAI
    string memory _symbol, // eg. IDLEDAI
    address _token,
    uint256 _pid
  ) public ERC20Detailed(_name, _symbol, uint8(18)) {
    token = _token;
    pid = _pid;
    masterChef = address(0x0769fd68dFb93167989C6f7254cd0D766Fb2841F); // polygon MiniChef v2
    Ownable(msg.sender);
    IERC20(_token).approve(masterChef, uint256(-1));
  }

  modifier onlyGeyser() {
    require(msg.sender == _geyser, "Tokenizer: Not Geyser");
    _;
  }

  function geyser() public view returns (address) {
    return _geyser;
  }

  function wrap(uint256 _amount) external {
    IERC20(token).safeTransferFrom(msg.sender, address(this), _amount);
    IMasterChef(masterChef).deposit(pid, _amount, address(this));
    _mint(msg.sender, _amount);
  }

  function unwrap(uint256 _amount, address _account) external {
    // IMasterChef(masterChef).withdrawAndHarvest(pid, _amount, address(this));
    IMasterChef(masterChef).withdraw(pid, _amount, address(this));
    _burn(msg.sender, _amount);
    IERC20(token).safeTransfer(_account, _amount);
  }

  function unwrapFor(uint256 _amount, address _account) external onlyGeyser {
    // IMasterChef(masterChef).withdrawAndHarvest(pid, _amount, address(this));
    IMasterChef(masterChef).withdraw(pid, _amount, address(this));
    _burn(_account, _amount);
    IERC20(token).safeTransfer(_account, _amount);
  }

  function transferGeyser(address geyser_) external onlyOwner {
    _geyser = geyser_;
  }

  // used both to rescue SUSHI rewards and eventually other tokens
  function rescueFunds(address tokenToRescue, address to, uint256 amount) external onlyOwner returns (bool) {
    return IERC20(tokenToRescue).transfer(to, amount);
  }

  // used both to rescue SUSHI rewards and eventually other tokens
  function harvestRewards() external onlyOwner returns () {
    // Idle Treasury League Multisig wallet on polygon
    IMasterChef(masterChef).harvest(pid, address(0x61A944Ca131Ab78B23c8449e0A2eF935981D5cF6));
  }

  function emergencyShutdown(uint256 _amount) external onlyOwner {
    // Idle Treasury League Multisig wallet on polygon
    address _idleFeeTreasury = address(0x61A944Ca131Ab78B23c8449e0A2eF935981D5cF6);
    IMasterChef(masterChef).withdraw(pid, _amount, address(this));
    IERC20(token).safeTransfer(_idleFeeTreasury, _amount);
  }
}

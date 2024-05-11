/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable max-len */
// This is a script for deployment and automatically verification of all the contracts (`contracts/`).
import { Contract } from "ethers";
import { ethers, network } from "hardhat";
import type { BigNumber } from "ethers";

const addressWithEnoughDelegate = "0x9AA835Bc7b8cE13B9B0C9764A52FbF71AC62cCF1"; // a16z
const timelockAddress = "0xc0Da02939E1441F497fd74F78cE7Decb17B66529"; // GovernorBravoDelegator
const comptrollerAddress = "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B"; // Unitroller

const grantCompTo = "0xc10785fB7b1adD4fD521A27d0d55c5561EEf0940"; // AG address
const amount = ethers.utils.parseUnits('75246', 18).toString() // 75246 COMP
// const amount = ethers.utils.parseUnits('2000000', 18).toString() // UNREAL AMOUNT OF COMP, 2M, should fail

export const COMP_WHALES =  [
    "0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1",
    "0x683a4f9915d6216f73d6df50151725036bd26c02",
    "0x8169522c2C57883E8EF80C498aAB7820dA539806",
    "0x8d07D225a769b7Af3A923481E1FdF49180e6A265",
    "0x7d1a02C0ebcF06E1A36231A54951E061673ab27f",
    "0x54A37d93E57c5DA659F508069Cf65A381b61E189"
];

async function main() {
    const timelock = new Contract(
        timelockAddress,
        [
            "function propose(address[] memory, uint[] memory, string[] memory, bytes[] memory, string memory) public returns (uint)",
            "function queue(uint proposalId) external",
            "function execute(uint proposalId) external",
            "function proposalCount() external view returns (uint)",
            "function state(uint proposalId) external view returns (uint)",
            "function castVote(uint proposalId, uint8 support) external",
            "function proposals(uint proposalId) external view returns (tuple(uint256 id, address proposer, uint256 eta, uint256 startBlock, uint256 endBlock, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, bool canceled, bool executed))"
        ],
        ethers.provider
    );
    const _grantCompCalldata = ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [grantCompTo, amount]
    );
    // impersonate the address with enough delegate
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [addressWithEnoughDelegate],
    });

    const signer = ethers.provider.getSigner(addressWithEnoughDelegate);
    const tx = await timelock.connect(signer).propose(
        [comptrollerAddress],
        [0],
        ["_grantComp(address,uint256)"],
        [_grantCompCalldata],
        "Grant COMP to delegate"
    );

    console.log('Data that should be passed into etherscan', [comptrollerAddress],[0],["_grantComp(address,uint256)"],[_grantCompCalldata], "Grant COMP to delegate")
    
    await tx.wait();
    const proposalId = await timelock.proposalCount();
    console.log("Passed proposal");
    console.log("Proposal ID: ", proposalId.toString());
    console.log("Parameters: ");
    console.log("Target: ", comptrollerAddress);
    console.log("Value: ", 0);
    console.log("Signature: ", "_grantComp(address,uint256)");
    console.log("Data: ", _grantCompCalldata);
    console.log("Description: ", "Grant COMP to delegate");
    const proposal = await timelock.proposals(proposalId);
    console.log("Proposal data: ", proposal);
    console.log("Try to queue the proposal");
    console.log("Proposal state: ", await timelock.state(proposalId));

    const startBlock: BigNumber = proposal.startBlock;
    const endBlock = proposal.endBlock;
    const blockNow = await ethers.provider.getBlockNumber();
    const blocksUntilStart = startBlock.toNumber() - blockNow;
    const blocksUntilEnd = endBlock.toNumber() - Math.max(startBlock.toNumber(), blockNow);

    if (blocksUntilStart > 0) {
        // await mineBlocks(dm, blocksUntilStart);
        console.log("Waiting for start block");
        await network.provider.send("hardhat_mine", [`0x${blocksUntilStart.toString(16)}`]);
    }

    if (blocksUntilEnd > 0) {
        for (const whale of COMP_WHALES) {
            // Voting can fail if voter has already voted
            // const voter = await impersonateAddress(dm, whale);
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [whale],
            });
            const voter = ethers.provider.getSigner(whale);
            await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
            await timelock.connect(voter).castVote(proposalId, 1, { gasPrice: 0 });
        }
        // await mineBlocks(dm, blocksUntilEnd);
        console.log("Waiting for end block");
        await network.provider.send("hardhat_mine", [`0x${blocksUntilEnd.toString(16)}`]);
      }
    await timelock.connect(signer).queue(proposalId);
    console.log("Queued proposal");
    const newProposalData = await timelock.proposals(proposalId);
    await network.provider.send("evm_mine", [newProposalData.eta.toNumber()]);

    console.log("Try to execute the proposal");
    await timelock.connect(signer).execute(proposalId);
    console.log("Executed proposal");
}

// This pattern is recommended to be able to use async/await everywhere and properly handle errors.
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

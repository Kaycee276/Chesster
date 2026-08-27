import { rpc, TransactionBuilder, Networks, Contract, nativeToScVal, Transaction } from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

const RPC_URL = import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;
const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_CONTRACT_ADDRESS || "";

const server = new rpc.Server(RPC_URL);

export async function depositXLM(fnName: "create_match" | "join_match", gameCode: string, amount: string, publicKey: string) {
    if (!ESCROW_ADDRESS) throw new Error("Escrow contract address not configured");

    const account = await server.getAccount(publicKey);
    const contract = new Contract(ESCROW_ADDRESS);

    // Convert amount to stroops (1 XLM = 10,000,000 stroops)
    const amountStroops = BigInt(Math.round(parseFloat(amount) * 10_000_000)).toString();

    // The native token address on testnet
    const nativeTokenAddress = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

    const tx = new TransactionBuilder(account, {
        fee: "10000",
        networkPassphrase: NETWORK_PASSPHRASE,
    })
    .addOperation(
        contract.call(
            fnName,
            nativeToScVal(gameCode, { type: "string" }),
            nativeToScVal(publicKey, { type: "address" }),
            ...(fnName === "create_match" ? [nativeToScVal(nativeTokenAddress, { type: "address" })] : []),
            nativeToScVal(amountStroops, { type: "i128" })
        )
    )
    .setTimeout(30)
    .build();

    const preparedTx = await server.prepareTransaction(tx);
    const signedResponse = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: NETWORK_PASSPHRASE,
    });

    if ("error" in signedResponse && signedResponse.error) {
        throw new Error(String(signedResponse.error));
    }

    const xdr = "signedTxXdr" in signedResponse ? signedResponse.signedTxXdr : "";
    if (!xdr) throw new Error("Signing failed: no signed XDR returned");

    const sendResponse = await server.sendTransaction(
        TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE) as unknown as Transaction
    );

    if (sendResponse.status === "PENDING") {
        let txResponse = await server.getTransaction(sendResponse.hash);
        while (txResponse.status === "NOT_FOUND") {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            txResponse = await server.getTransaction(sendResponse.hash);
        }
        if (txResponse.status !== "SUCCESS") {
            throw new Error(`Transaction failed: ${JSON.stringify(txResponse)}`);
        }
    } else {
        throw new Error(`Transaction failed: ${JSON.stringify(sendResponse)}`);
    }
}

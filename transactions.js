import {
    Connection,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
    VersionedTransaction,
    LAMPORTS_PER_SOL,
    Keypair,
    SendTransactionError
} from '@solana/web3.js';
import fetch from 'node-fetch';
import { getUserWallet, getReferrer } from './database.js';
import { getUserBalance } from './wallet.js';

const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const TEAM_WALLET_ADDRESS = process.env.TEAM_WALLET_ADDRESS;

const web3Connection = new Connection(RPC_ENDPOINT, 'confirmed');
const MIN_RENT_EXEMPT_BALANCE = 0.00203928;

async function getLatestBlockhash(retries = 3, baseDelay = 1000) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const blockhashInfo = await web3Connection.getLatestBlockhash();
            return blockhashInfo.blockhash;
        } catch (error) {
            console.warn(`Attempt ${attempt + 1} failed: ${error.message}`);
            const jitter = Math.random() * baseDelay;
            const delay = baseDelay * Math.pow(2, attempt) + jitter;
            console.log(`Retrying after ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw new Error('Failed to fetch the latest blockhash: All retry attempts failed.');
}

// Ensure rent exemption for an account
async function ensureRentExemption(wallet, connection) {
    const balance = await connection.getBalance(wallet.publicKey);
    if (balance < MIN_RENT_EXEMPT_BALANCE * LAMPORTS_PER_SOL) {
        throw new Error('Account does not have enough SOL to cover rent exemption.');
    }
}

// Handle withdraw transaction
export async function handleWithdraw(userId, amountInSol, destinationAddress, retries = 3, baseDelay = 1000) {
    const wallet = await getUserWallet(userId);
    if (!wallet) {
        return "No wallet found. Please start by generating a wallet.";
    }

    await ensureRentExemption(wallet, web3Connection);

    const balance = await getUserBalance(userId);
    if (balance < amountInSol) {
        return "Insufficient balance for withdrawal.";
    }

    const lamports = Math.floor(amountInSol * LAMPORTS_PER_SOL);
    const transaction = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new PublicKey(destinationAddress),
            lamports
        })
    );

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const signature = await sendAndConfirmTransaction(web3Connection, transaction, [wallet]);
            return `Withdrawal successful: https://solscan.io/tx/${signature}`;
        } catch (error) {
            if (error.message.includes("Too Many Requests") || error instanceof SendTransactionError) {
                const jitter = Math.random() * baseDelay;
                const retryDelay = baseDelay * Math.pow(2, attempt) + jitter;
                console.error(`Attempt ${attempt + 1} failed due to rate limit. Retrying after ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
                console.error("Error sending transaction:", error);
                return `Withdrawal failed: ${error.message}.`;
            }
        }
    }

    return "Withdrawal failed after multiple attempts due to node lag.";
}

// Handle buy transaction
export async function handleBuyTransaction(userId, amount, tokenMint, retries = 3, baseDelay = 1000) {
    const wallet = await getUserWallet(userId);
    if (!(wallet instanceof Keypair)) {
        throw new Error("Invalid wallet object; expected a Keypair.");
    }

    await ensureRentExemption(wallet, web3Connection);

    const balance = await getUserBalance(userId);
    if (balance < MIN_RENT_EXEMPT_BALANCE) {
        return `Transaction failed: Your balance (${balance} SOL) is too low to cover rent. Please deposit more SOL.`;
    }

    const referrerId = await getReferrer(userId);
    let signature;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const latestBlockhash = await getLatestBlockhash();

        const netAmount = amount * 0.99;
        const feeAmount = amount * 0.01;

        const response = await fetch("https://pumpportal.fun/api/trade-local", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "publicKey": wallet.publicKey.toBase58(),
                "action": "buy",
                "mint": tokenMint,
                "amount": netAmount,
                "denominatedInSol": "true",
                "slippage": 10,
                "priorityFee": 0.00001,
                "pool": "pump"
            })
        });

        if (response.status !== 200) {
            return "Failed to generate transaction: " + response.statusText;
        }

        const transactionData = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(transactionData));
        tx.recentBlockhash = latestBlockhash;
        tx.sign([wallet]);

        try {
            signature = await web3Connection.sendTransaction(tx, {
                skipPreflight: true,
                preflightCommitment: "confirmed",
                maxRetries: 0
            });

            const confirmation = await web3Connection.confirmTransaction(
                { signature, blockhash: latestBlockhash },
                'confirmed'
            );
            if (confirmation.value.err) {
                throw new Error('Transaction failed: ' + JSON.stringify(confirmation.value.err));
            }

            const feeTransaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: new PublicKey(TEAM_WALLET_ADDRESS),
                    lamports: feeAmount * LAMPORTS_PER_SOL,
                })
            );

            if (referrerId) {
                const referrerWallet = await getUserWallet(referrerId);
                if (referrerWallet) {
                    const referrerFee = feeAmount * 0.35;
                    feeTransaction.add(
                        SystemProgram.transfer({
                            fromPubkey: wallet.publicKey,
                            toPubkey: referrerWallet.publicKey,
                            lamports: referrerFee * LAMPORTS_PER_SOL,
                        })
                    );
                }
            }

            await sendAndConfirmTransaction(web3Connection, feeTransaction, [wallet]);

            console.log(`Transaction successful: https://solscan.io/tx/${signature}`);
            return `Transaction successful: https://solscan.io/tx/${signature}`;

        } catch (error) {
            if (error.message.includes("Too Many Requests") || error instanceof SendTransactionError) {
                const jitter = Math.random() * baseDelay;
                const retryDelay = baseDelay * Math.pow(2, attempt) + jitter;
                console.error(`Attempt ${attempt + 1} failed due to rate limit. Retrying after ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else if (error.message.includes("Transaction already processed")) {
                console.log("Transaction already processed, skipping retry.");
                return `Transaction already processed: https://solscan.io/tx/${signature}`;
            } else {
                console.error("Error sending transaction:", error);
                return `Transaction failed: ${error.message}.`;
            }
        }
    }

    return "Transaction failed after multiple attempts due to node lag.";
}

// Handle sell transaction
export async function handleSellTransaction(userId, percentage, tokenMint, retries = 3, baseDelay = 1000) {
    const wallet = await getUserWallet(userId);
    const referrerId = await getReferrer(userId);
    if (!wallet) {
        return "No wallet found. Please start by generating a wallet.";
    }

    await ensureRentExemption(wallet, web3Connection);

    let signature;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const latestBlockhash = await getLatestBlockhash();

        const amount = `${percentage}%`;

        const response = await fetch("https://pumpportal.fun/api/trade-local", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "publicKey": wallet.publicKey,
                "action": "sell",
                "mint": tokenMint,
                "amount": amount,
                "denominatedInSol": "false",
                "slippage": 10,
                "priorityFee": 0.00001,
                "pool": "pump"
            })
        });

        if (response.status !== 200) {
            return "Failed to generate transaction: " + response.statusText;
        }

        const transactionData = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(transactionData));
        tx.recentBlockhash = latestBlockhash;
        tx.sign([wallet]);

        try {
            signature = await web3Connection.sendTransaction(tx, {
                skipPreflight: true,
                preflightCommitment: "confirmed",
                maxRetries: 0
            });

            const confirmation = await web3Connection.confirmTransaction(
                { signature, blockhash: latestBlockhash },
                'confirmed'
            );
            if (confirmation.value.err) {
                throw new Error('Transaction failed: ' + JSON.stringify(confirmation.value.err));
            }

            const newBalance = await getUserBalance(userId);
            if (isNaN(newBalance)) {
                return "Failed to retrieve new balance after selling.";
            }

            const feeAmount = newBalance * 0.01;
            const lamportsForFee = BigInt(Math.floor(feeAmount * LAMPORTS_PER_SOL));

            const feeTransaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: new PublicKey(wallet.publicKey),
                    toPubkey: new PublicKey(TEAM_WALLET_ADDRESS),
                    lamports: lamportsForFee,
                })
            );

            if (referrerId) {
                const referrerWallet = await getUserWallet(referrerId);
                if (referrerWallet) {
                    const referrerFee = feeAmount * 0.35;
                    const lamportsForReferrer = BigInt(Math.floor(referrerFee * LAMPORTS_PER_SOL));
                    feeTransaction.add(
                        SystemProgram.transfer({
                            fromPubkey: new PublicKey(wallet.publicKey),
                            toPubkey: new PublicKey(referrerWallet.publicKey),
                            lamports: lamportsForReferrer,
                        })
                    );
                }
            }

            await sendAndConfirmTransaction(web3Connection, feeTransaction, [wallet]);

            return `Transaction successful: https://solscan.io/tx/${signature}`;

        } catch (error) {
            if (error.message.includes("Too Many Requests") || error instanceof SendTransactionError) {
                const jitter = Math.random() * baseDelay;
                const retryDelay = baseDelay * Math.pow(2, attempt) + jitter;
                console.error(`Attempt ${attempt + 1} failed due to rate limit. Retrying after ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else if (error.message.includes("Transaction already processed")) {
                console.log("Transaction already processed, skipping retry.");
                return `Transaction already processed: https://solscan.io/tx/${signature}`;
            } else {
                console.error("Error sending transaction:", error);
                return `Transaction failed: ${error.message}.`;
            }
        }
    }

    return "Transaction failed after multiple attempts due to node lag.";
}

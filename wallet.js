import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
import { getUserWallet, saveUserWallet } from './database.js';

const RPC_ENDPOINT = process.env.RPC_ENDPOINT;
const web3Connection = new Connection(RPC_ENDPOINT, 'confirmed');

export async function loadOrCreateWallet(userId) {
    let wallet = await getUserWallet(userId);
    if (wallet) {
        return wallet;
    }

    const newWallet = Keypair.generate();
    const referralId = uuidv4();
    const walletData = {
        userId,
        publicKey: newWallet.publicKey.toBase58(),
        secretKey: bs58.encode(newWallet.secretKey),
        referralId
    };
    await saveUserWallet(userId, walletData);
    return newWallet;
}

export async function exportPrivateKey(userId) {
    const wallet = await getUserWallet(userId);
    return wallet ? bs58.encode(wallet.secretKey) : null;
}

export async function generateDepositAddress(userId) {
    const wallet = await loadOrCreateWallet(userId);
    return wallet.publicKey.toBase58();
}

export async function getUserBalance(userId) {
    const wallet = await getUserWallet(userId);
    if (!wallet) {
        return 0;
    }

    const balance = await web3Connection.getBalance(wallet.publicKey);
    return balance / LAMPORTS_PER_SOL;
}

export async function getUserBalances(userId) {
    const wallet = await getUserWallet(userId);
    if (!wallet) {
        return "No wallet found.";
    }

    const accounts = await web3Connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
        programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
    });

    let tokenList = [];
    let balances = "Your token balances:\n";
    for (let account of accounts.value) {
        const tokenAmount = account.account.data.parsed.info.tokenAmount;
        if (tokenAmount.uiAmount > 0) {
            const tokenMint = account.account.data.parsed.info.mint;
            const tokenInfo = await getTokenMetadata(tokenMint);
            const tokenSymbol = tokenInfo?.symbol || "Unknown";
            balances += `Token: ${tokenSymbol}, Balance: ${tokenAmount.uiAmountString}\n`;
            tokenList.push({ mint: tokenMint, symbol: tokenSymbol, balance: tokenAmount.uiAmount });
        }
    }

    if (tokenList.length === 0) {
        balances += "No tokens found.\n";
    }

    return { balances, tokenList };
}

// Fetch token metadata using Helius RPC (or any other method you'd prefer)
async function getTokenMetadata(tokenMint) {
    const options = {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getAsset",
            params: [tokenMint]
        })
    };
    const response = await fetch(RPC_ENDPOINT, options);
    const data = await response.json();
    return data.result.content.metadata;
}

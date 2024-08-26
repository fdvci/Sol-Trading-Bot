import { MongoClient } from 'mongodb';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const mongoUri = process.env.MONGO_URI;
let db;

// Initialize MongoDB connection
export async function initializeDatabase() {
    const client = new MongoClient(mongoUri);
    await client.connect();
    db = client.db('tradingBot');
}

function getCollection(name) {
    return db.collection(name);
}

// Get the user's wallet from the database and return as a Keypair
export async function getUserWallet(userId) {
    const collection = getCollection('wallets');
    const walletData = await collection.findOne({ userId });

    if (walletData && walletData.secretKey) {
        return Keypair.fromSecretKey(bs58.decode(walletData.secretKey));
    }
    return null;
}

// Save the user's wallet data in the database
export async function saveUserWallet(userId, walletData) {
    const collection = getCollection('wallets');
    await collection.updateOne({ userId }, { $set: walletData }, { upsert: true });
}

// Referral-related functions (getUserReferralId, updateReferralData, getReferrer)
export async function getUserReferralId(userId) {
    const collection = getCollection('wallets');
    const wallet = await collection.findOne({ userId });
    return wallet?.referralId || null;
}

export async function updateReferralData(userId, referrerId) {
    const collection = getCollection('referrals');
    await collection.updateOne({ userId }, { $set: { referrer: referrerId } }, { upsert: true });
}

export async function getReferrer(userId) {
    const collection = getCollection('referrals');
    const referral = await collection.findOne({ userId });
    return referral?.referrer || null;
}

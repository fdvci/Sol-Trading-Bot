import { loadOrCreateWallet, exportPrivateKey, generateDepositAddress, getUserBalance, getUserBalances } from './wallet.js';
import { handleWithdraw, handleBuyTransaction, handleSellTransaction } from './transactions.js';
import { getUserReferralId, updateReferralData, getUserWallet } from './database.js';

let userState = {}; // Keep track of user states

export function handleTelegramCommands(bot) {
    bot.onText(/\/start/, async (msg) => {
        const userId = msg.from.id.toString();
        const wallet = await loadOrCreateWallet(userId);
        const balance = await getUserBalance(userId);
        const referralId = await getUserReferralId(userId);

        const welcomeMessage = `
Welcome to PeelyBOT!

You currently have a balance of ${balance.toFixed(4)} SOL.

To get started trading, you can open a position by buying a token.

To buy a token just enter a ticker and you will see a Buy dashboard pop up where you can choose how much you want to buy.

Your referral link: https://t.me/PeelyOnSOLBOT?start=${referralId}

Wallet: ${wallet.publicKey.toBase58()}`;

        const mainMenu = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Buy", callback_data: 'buy_tokens' }],
                    [{ text: "Sell & Manage", callback_data: 'sell_tokens' }],
                    [{ text: "Deposit", callback_data: 'deposit' }],
                    [{ text: "Withdraw", callback_data: 'withdraw' }],
                    [{ text: "Export Private Key", callback_data: 'export_private_key' }],
                    [{ text: "Help", callback_data: 'help' }],
                    [{ text: "Refer Friends", callback_data: 'refer_friends' }],
                ]
            }
        };

        bot.sendMessage(msg.chat.id, welcomeMessage, mainMenu);
    });

    const helpMessage = `
Available Commands:
/start - Start the bot and generate your wallet
/deposit - Get your deposit address
/withdraw <amount_in_SOL> <destination_address> - Withdraw SOL to another wallet
/help - Display this help message
/export_private_key - Export your wallet's private key
/refer_friends - Get your referral link to earn rewards
`;

    bot.onText(/\/help/, (msg) => {
        bot.sendMessage(msg.chat.id, helpMessage);
    });

    bot.onText(/\/deposit/, async (msg) => {
        const userId = msg.from.id.toString();
        const depositAddress = await generateDepositAddress(userId);
        bot.sendMessage(msg.chat.id, `Deposit SOL to this address:\n${depositAddress}`);
    });

    bot.onText(/\/withdraw (.+)/, async (msg, match) => {
        const userId = msg.from.id.toString();
        const params = match[1].split(" ");
        if (params.length !== 2) {
            bot.sendMessage(msg.chat.id, "Invalid command format. Use /withdraw <amount_in_SOL> <destination_address>.");
            return;
        }

        const amountInSol = parseFloat(params[0]);
        const destinationAddress = params[1];

        if (isNaN(amountInSol) || !destinationAddress) {
            bot.sendMessage(msg.chat.id, "Invalid amount or address. Please check your input.");
            return;
        }

        const result = await handleWithdraw(userId, amountInSol, destinationAddress);
        bot.sendMessage(msg.chat.id, result);
    });

    bot.on('callback_query', async (callbackQuery) => {
        const userId = callbackQuery.from.id.toString();
        const msg = callbackQuery.message;
        const data = callbackQuery.data;

        if (data === 'buy_tokens') {
            userState[userId] = { step: 'awaiting_contract_address' };
            bot.sendMessage(msg.chat.id, "Please send the contract address of the token you want to buy.");
        } else if (data === 'sell_tokens') {
            const { balances, tokenList } = await getUserBalances(userId);
            bot.sendMessage(msg.chat.id, balances);

            if (tokenList.length > 0) {
                const sellButtons = tokenList.map((token) => {
                    return [
                        { text: `Sell 25% of ${token.symbol}`, callback_data: `sell_${token.mint}_25` },
                        { text: `Sell 50% of ${token.symbol}`, callback_data: `sell_${token.mint}_50` },
                        { text: `Sell 75% of ${token.symbol}`, callback_data: `sell_${token.mint}_75` },
                        { text: `Sell 100% of ${token.symbol}`, callback_data: `sell_${token.mint}_100` }
                    ];
                });

                bot.sendMessage(msg.chat.id, "Choose how much you want to sell:", {
                    reply_markup: {
                        inline_keyboard: sellButtons
                    }
                });
            } else {
                bot.sendMessage(msg.chat.id, "No tokens available to sell.");
            }
        } else if (data === 'deposit') {
            const depositAddress = await generateDepositAddress(userId);
            bot.sendMessage(msg.chat.id, `Deposit SOL to this address:\n${depositAddress}`);
        } else if (data === 'withdraw') {
            bot.sendMessage(msg.chat.id, "To withdraw SOL, use the command /withdraw <amount_in_SOL> <destination_address>.");
        } else if (data === 'export_private_key') {
            const privateKey = await exportPrivateKey(userId);
            if (privateKey) {
                bot.sendMessage(msg.chat.id, `Your private key is: ${privateKey}`);
            } else {
                bot.sendMessage(msg.chat.id, "No wallet found.");
            }
        } else if (data === 'refer_friends') {
            const referralId = await getUserReferralId(userId);
            if (referralId) {
                bot.sendMessage(msg.chat.id, `Share your referral link: https://t.me/PeelyOnSOLBOT?start=${referralId}`);
            } else {
                bot.sendMessage(msg.chat.id, "No referral ID found.");
            }
        } else if (data === 'help') {
            bot.sendMessage(msg.chat.id, helpMessage);
        } else if (data.startsWith('buy_')) {
            const [_, contractAddress, solAmount] = data.split('_');
            const amount = parseFloat(solAmount);

            const result = await handleBuyTransaction(userId, amount, contractAddress);
            bot.sendMessage(msg.chat.id, result);
        } else if (data.startsWith('sell_')) {
            const [_, tokenMint, percentage] = data.split('_');
            const percentageValue = parseInt(percentage, 10);

            const result = await handleSellTransaction(userId, percentageValue, tokenMint);
            bot.sendMessage(msg.chat.id, result);
        }
    });

    bot.on('message', async (msg) => {
        const userId = msg.from.id.toString();
        const text = msg.text.trim();

        if (userState[userId] && userState[userId].step === 'awaiting_contract_address') {
            const contractAddress = text;

            userState[userId] = { step: 'awaiting_sol_amount', contractAddress };

            const buyAmountButtons = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "0.05 SOL", callback_data: `buy_${contractAddress}_0.05` }],
                        [{ text: "0.1 SOL", callback_data: `buy_${contractAddress}_0.1` }],
                        [{ text: "0.5 SOL", callback_data: `buy_${contractAddress}_0.5` }],
                        [{ text: "1 SOL", callback_data: `buy_${contractAddress}_1` }],
                        [{ text: "2 SOL", callback_data: `buy_${contractAddress}_2` }],
                    ]
                }
            };
            bot.sendMessage(msg.chat.id, "How much SOL do you want to spend?", buyAmountButtons);
        }
    });

    bot.onText(/\/start (.+)/, async (msg, match) => {
        const userId = msg.from.id.toString();
        const referrerId = match[1];

        const wallet = await getUserWallet(userId);
        if (!wallet) {
            await loadOrCreateWallet(userId);
            await updateReferralData(userId, referrerId);
        }

        bot.emit('text', msg);
    });
}

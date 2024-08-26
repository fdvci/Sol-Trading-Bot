import dotenv from 'dotenv';
import TelegramBot from 'node-telegram-bot-api';
import { initializeDatabase } from './database.js';
import { handleTelegramCommands } from './telegram.js';

dotenv.config();

const botToken = process.env.BOT_TOKEN;
const bot = new TelegramBot(botToken, { polling: true });

// Initialize the database connection
initializeDatabase().then(() => {
    console.log('Database connected successfully.');
    // Set up Telegram bot commands
    handleTelegramCommands(bot);
}).catch((err) => {
    console.error('Failed to connect to the database:', err);
});

// Handle polling errors
bot.on("polling_error", (err) => console.log(`Polling error: ${err.message}`));

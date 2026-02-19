const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// ВАЖНЫЕ НАСТРОЙКИ (Заполните своими данными)
const TOKEN = '8327093113:AAEfOI7sJMOQDlLuvYbcc_jAzyU6Xs7R2Sg'; 
const MANAGER_URL = "https://t.me/reznikovru"; 
const COMBINED_PHOTO = 'https://github.com/s1ngleee/unit_pack/blob/main/1.jpg';

// 1. Создаем мини-сервер (нужно для бесплатных хостингов, чтобы бот не "усыпал")
const app = express();
app.get('/', (req, res) => res.send('Бот работает 24/7!'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Сервер запущен на порту ${port}`));

// 2. Инициализируем бота (режим polling - бот сам опрашивает серверы Telegram)
const bot = new TelegramBot(TOKEN, { polling: true });

// 3. Оперативная память бота (вместо PropertiesService в Google)
const sessions = {};
function getSession(chatId) {
    if (!sessions[chatId]) {
        sessions[chatId] = { state: 'START' };
    }
    return sessions[chatId];
}

// Шаблон кнопки менеджера
const managerKeyboard = {
    inline_keyboard: [[{ text: "💬 Написать менеджеру", url: MANAGER_URL }]]
};

// --- ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.text) return; // Игнорируем стикеры и фото
    await processFunnel(chatId, msg.text);
});

// --- ОБРАБОТЧИК НАЖАТИЙ НА КНОПКИ (Inline) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    // Telegram требует подтверждать нажатие кнопки, чтобы убрать часики загрузки
    await bot.answerCallbackQuery(query.id); 
    await processFunnel(chatId, data);
});

// --- ГЛАВНАЯ ЛОГИКА ВОРОНКИ ---
async function processFunnel(chatId, text) {
    const session = getSession(chatId);
    let state = session.state;

    if (text === 'btn_regular') text = "📦 Четырёхклапанная";
    if (text === 'btn_self') text = "✂️ Самосборная";

    // УДАЛЕНИЕ ПРЕДЫДУЩЕГО СООБЩЕНИЯ
    if (session.last_msg_id && text !== '/start') {
        try {
            await bot.deleteMessage(chatId, session.last_msg_id);
        } catch (e) {} // Игнорируем ошибку, если сообщение уже удалено
    }

    // ВОЗВРАТЫ НАЗАД
    if (text === 'btn_change_qty') {
        await sendMessage(chatId, "Какое **количество коробок** вам нужно? (Введите число):", null, true);
        session.state = 'WAIT_QUANTITY';
        return;
    }
    if (text === 'btn_change_dim') {
        await sendMessage(chatId, "Введите **длину, ширину и высоту** коробки в миллиметрах через пробел.\n\n_(Например: 600 400 300)_:", null, true);
        session.state = 'WAIT_DIMENSIONS';
        return;
    }

    // 1. СТАРТ
    if (text === '/start') {
        try {
            await bot.sendPhoto(chatId, COMBINED_PHOTO);
        } catch (e) {
            console.error("Ошибка отправки фото", e);
        }

        const inlineKeyboard = {
            inline_keyboard: [
                [{ text: "📦 Четырёхклапанная", callback_data: "btn_regular" }],
                [{ text: "✂️ Самосборная", callback_data: "btn_self" }],
                [{ text: "💬 Написать менеджеру", url: MANAGER_URL }]
            ]
        };
        
        await sendMessage(chatId, "👋 Привет! Я помогу рассчитать стоимость вашей коробки.\n\nВыберите **вид коробки** для самостоятельного расчета или свяжитесь с нами:", inlineKeyboard, true);
        session.state = 'WAIT_BOX_TYPE';
        return;
    }

    // 2. ЗАПРОС ТИРАЖА
    if (state === 'WAIT_BOX_TYPE') {
        session.boxType = text;
        await sendMessage(chatId, `Отлично! Вы выбрали: **${text}**.\n\nКакое **количество коробок** вам нужно? (Введите число):`, null, true);
        session.state = 'WAIT_QUANTITY';
    } 
    // 3. ПРОВЕРКА ТИРАЖА -> ЗАПРОС РАЗМЕРОВ
    else if (state === 'WAIT_QUANTITY') {
        const quantity = parseInt(text, 10);
        if (isNaN(quantity) || quantity <= 0) {
            await sendMessage(chatId, "❌ Пожалуйста, введите корректное число для количества коробок.", null, true);
            return;
        }
        
        if (quantity < 1000) {
            const smallQtyKeyboard = {
                inline_keyboard: [
                    [{ text: "💬 Написать менеджеру", url: MANAGER_URL }],
                    [{ text: "🔄 Ввести другое количество", callback_data: "btn_change_qty" }]
                ]
            };
            await sendMessage(chatId, "⚠️ Тиражи меньше 1000 штук обговариваются индивидуально. Пожалуйста, напишите об этом нашему менеджеру для уточнения деталей заказа.", smallQtyKeyboard, true);
            session.state = 'START';
            return;
        }
        
        session.qty = quantity;
        await sendMessage(chatId, `✅ Принято, тираж: ${quantity} шт.\n\nТеперь введите **длину, ширину и высоту** коробки в миллиметрах через пробел.\n\n_(Например: 600 400 300)_:`, null, true);
        session.state = 'WAIT_DIMENSIONS';
    }
    // 4. ПОЛУЧЕНИЕ РАЗМЕРОВ И РАСЧЕТ
    else if (state === 'WAIT_DIMENSIONS') {
        const dimensions = text.trim().split(/\s+/);
        
        if (dimensions.length !== 3) {
            await sendMessage(chatId, "❌ Ошибка: нужно ввести ровно три числа через пробел (Длина Ширина Высота). Попробуйте еще раз:", null, true);
            return;
        }

        const boxType = session.boxType;
        const quantity = session.qty;
        const length = parseFloat(dimensions[0]);
        const width = parseFloat(dimensions[1]);
        const height = parseFloat(dimensions[2]);

        if (isNaN(length) || isNaN(width) || isNaN(height) || length <= 0 || width <= 0 || height <= 0) {
            await sendMessage(chatId, "❌ Ошибка: размеры должны быть положительными числами. Попробуйте еще раз:", null, true);
            return;
        }

        let finalMessage = `✅ **Расчет готов!**\n\n` +
                           `Тип: ${boxType}\n` +
                           `Тираж: ${quantity} шт.\n` +
                           `Внутренние размеры: ${length}x${width}x${height} мм\n\n`;

        let finalKeyboard = {
            inline_keyboard: [
                [{ text: "💬 Написать менеджеру", url: MANAGER_URL }],
                [{ text: "🔄 Новый расчёт", callback_data: "/start" }]
            ]
        };

        // --- ЛОГИКА ЧЕТЫРЕХКЛАПАННОЙ ---
        if (boxType === "📦 Четырёхклапанная") {
            const sheetLength = (2 * length) + (2 * width) + 30; 
            const sheetWidth = height + width + 8;               
            const sheetAreaMm2 = sheetLength * sheetWidth; 
            
            if (sheetLength < 500 || sheetWidth < 200) {
                finalMessage = `⚠️ **Размер слишком маленький.**\n\n` +
                               `Тип: ${boxType}\n` +
                               `Размер вашей заготовки составляет ${sheetLength} х ${sheetWidth} мм.\n` +
                               `Цена на такие миниатюрные размеры обговаривается индивидуально.\n\n` +
                               `Пожалуйста, напишите нашему менеджеру для уточнения деталей.`;
                finalKeyboard = {
                    inline_keyboard: [
                        [{ text: "💬 Написать менеджеру", url: MANAGER_URL }],
                        [{ text: "🔄 Ввести другие размеры", callback_data: "btn_change_dim" }]
                    ]
                };
            } 
            else if (sheetAreaMm2 < 1000000) {
                finalMessage = `⚠️ **Тираж слишком мал.**\n\n` +
                               `Тип: ${boxType}\n` +
                               `Площадь одной заготовки меньше 1 м² (${(sheetAreaMm2 / 1000000).toFixed(3)} м²).\n` +
                               `Для коробок такого размера текущий тираж (${quantity} шт.) слишком мал. Цена обговаривается индивидуально.\n\n` +
                               `Пожалуйста, напишите нашему менеджеру или сделайте новый расчет.`;
                finalKeyboard = {
                    inline_keyboard: [
                        [{ text: "💬 Написать менеджеру", url: MANAGER_URL }],
                        [{ text: "🔄 Новый расчёт", callback_data: "/start" }]
                    ]
                };
            }
            else {
                const sheetAreaM2 = sheetAreaMm2 / 1000000;          
                const pricePerM2 = 48.87;                               
                
                let pricePerPiece = quantity > 5000 ? (sheetAreaM2 * pricePerM2) + 3 : (sheetAreaM2 * pricePerM2) + 6;
                const totalPrice = pricePerPiece * quantity;            

                finalMessage += `💰 **Стоимость 1 коробки:** ${pricePerPiece.toFixed(2)} руб.\n`;
                finalMessage += `📦 **Итого за тираж:** ${totalPrice.toFixed(2)} руб.\n\n`;
                finalMessage += `_* Расчет предварительный. Для более точного расчета напишите менеджеру._`; 
            }
        } 
        // --- ЛОГИКА САМОСБОРНОЙ ---
        else if (boxType === "✂️ Самосборная") {
            const sheetLength = length + (4 * height) + 30;       
            const sheetWidth = (2 * width) + (3 * height) + 25;   
            
            const sheetAreaMm2 = sheetLength * sheetWidth;        
            const sheetAreaM2 = sheetAreaMm2 / 1000000;           
            const pricePerM2 = 28.5;                              
            
            let pricePerPiece = 0;
            if (sheetLength >= 350 && sheetLength < 900 && sheetWidth >= 350 && sheetWidth < 900) {
                pricePerPiece = (sheetAreaM2 * pricePerM2) + 8 + 3;
            } else {
                pricePerPiece = (sheetAreaM2 * pricePerM2) + 4.5 + 2;
            }

            const totalPrice = pricePerPiece * quantity;          
            const shtantsformaPrice = (sheetAreaM2 * 100) * 200 + 4000;

            finalMessage += `💰 **Стоимость 1 коробки:** ${pricePerPiece.toFixed(2)} руб.\n`;
            finalMessage += `📦 **Итого за тираж:** ${totalPrice.toFixed(2)} руб.\n`;
            finalMessage += `🗜 **Стоимость штанцформы (разовый платеж):** ${shtantsformaPrice.toFixed(2)} руб.\n\n`;
            finalMessage += `_* Расчет предварительный. Для более точного расчета напишите менеджеру._`; 
        }

        await sendMessage(chatId, finalMessage, finalKeyboard, false); 
        
        if (!finalMessage.includes("Размер слишком маленький") && !finalMessage.includes("Тираж слишком мал")) {
            delete session.last_msg_id;
        }
        session.state = 'START';
        
    } else {
        await sendMessage(chatId, "Я вас не понял. Для начала расчета выберите один из вариантов в меню или нажмите /start", null, true);
    }
}

// УНИВЕРСАЛЬНАЯ ФУНКЦИЯ ОТПРАВКИ СООБЩЕНИЙ
async function sendMessage(chatId, text, replyMarkup = null, saveMsgId = false) {
    const options = { parse_mode: 'Markdown' };
    if (replyMarkup) {
        options.reply_markup = replyMarkup;
    }
    
    try {
        const sentMsg = await bot.sendMessage(chatId, text, options);
        if (saveMsgId) {
            getSession(chatId).last_msg_id = sentMsg.message_id;
        }
    } catch (e) {
        console.error("Ошибка при отправке сообщения:", e.message);
    }
}

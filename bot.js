require('dotenv').config();

const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pdfParse = require('pdf-parse');

const bot = new Telegraf(process.env.BOT_TOKEN);

// ==================================================
// НАСТРОЙКИ
// ==================================================

const MANAGER_ID = 8054554420;

const KASPI_PAYMENT_URL =
    process.env.KASPI_PAYMENT_URL ||
    'https://pay.kaspi.kz/pay/azxk1ua';

const RECIPIENT_NAME =
    process.env.RECIPIENT_NAME || 'ИП АБЛ';

const RECIPIENT_BIN =
    process.env.RECIPIENT_BIN || '850124400808';

// Ссылка именно на WhatsApp-группу
const WHATSAPP_GROUP_URL =
    process.env.WHATSAPP_GROUP_URL || '';


// ==================================================
// КНИГИ
// ==================================================

const books = [
    {
        id: 1,
        title: '14 күнде өз ойымды жазып үйренемін',
        price: 990,
        file: 'book1.pdf'
    },
    {
        id: 2,
        title: 'Өз сөзіммен мазмұндаймын',
        price: 990,
        file: 'book2.pdf'
    },
    {
        id: 3,
        title: 'Шығарма жазып үйренемін',
        price: 990,
        file: 'book3.pdf'
    },
    {
        id: 4,
        title: '14 күнде сауатты жазамын',
        price: 990,
        file: 'book4.pdf'
    }
];


// ==================================================
// ПАПКИ
// ==================================================

const BOOKS_DIR =
    path.join(__dirname, 'books');

const TEMP_RECEIPTS_DIR =
    path.join(__dirname, 'temp_receipts');

const USED_RECEIPTS_FILE =
    path.join(__dirname, 'used_receipts.json');

if (!fs.existsSync(BOOKS_DIR)) {
    fs.mkdirSync(BOOKS_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(TEMP_RECEIPTS_DIR)) {
    fs.mkdirSync(TEMP_RECEIPTS_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(USED_RECEIPTS_FILE)) {
    fs.writeFileSync(
        USED_RECEIPTS_FILE,
        JSON.stringify([], null, 2)
    );
}


// ==================================================
// INLINE-КНОПКИ
// ==================================================

function cb(text, callbackData) {
    return {
        text: text,
        callback_data: callbackData
    };
}

function urlButton(text, url) {
    return {
        text: text,
        url: url
    };
}

function keyboard(rows) {
    return {
        reply_markup: {
            inline_keyboard: rows
        }
    };
}


// ==================================================
// БЕЗОПАСНОЕ РЕДАКТИРОВАНИЕ
// ==================================================

async function safeEditMessageText(
    ctx,
    text,
    options = {}
) {
    try {
        return await ctx.editMessageText(
            text,
            options
        );
    } catch (error) {

        if (
            String(error.message).includes(
                'message is not modified'
            )
        ) {
            return;
        }

        throw error;
    }
}


// ==================================================
// СОСТОЯНИЯ
// ==================================================

const supportChats = new Set();

let managerReplyTo = null;

const carts = new Map();

const pendingPayments = new Map();

// Последнее главное меню пользователя
// Нужно для очистки старых меню при /start
const lastMenuMessages = new Map();


// ==================================================
// УДАЛЕНИЕ СТАРОГО МЕНЮ
// ==================================================

async function deleteLastMenu(userId) {

    const oldMessageId =
        lastMenuMessages.get(userId);

    if (!oldMessageId) {
        return;
    }

    try {

        await bot.telegram.deleteMessage(
            userId,
            oldMessageId
        );

    } catch (error) {

        // Если сообщение уже удалено —
        // ничего страшного
        console.log(
            'Старое меню удалить не удалось:',
            error.message
        );
    }

    lastMenuMessages.delete(userId);
}


// ==================================================
// ГЛАВНОЕ МЕНЮ
// ==================================================

function mainMenu(userId) {

    const cart =
        carts.get(userId) || [];

    const cartCount =
        cart.length;

    const cartText =
        cartCount > 0
            ? `🛒 Себет (${cartCount})`
            : '🛒 Себет';

    return keyboard([

        [
            cb(
                '📚 Каталог',
                'catalog'
            )
        ],

        [
            cb(
                '🎁 Акциялар',
                'sale'
            )
        ],

        [
            cb(
                cartText,
                'cart'
            )
        ],

        [
            cb(
                '❓ Қолдау',
                'support'
            )
        ]

    ]);
}


// ==================================================
// ИСПОЛЬЗОВАННЫЕ ЧЕКИ
// ==================================================

function getUsedReceipts() {

    try {

        return JSON.parse(
            fs.readFileSync(
                USED_RECEIPTS_FILE,
                'utf8'
            )
        );

    } catch {

        return [];
    }
}

function saveUsedReceipts(receipts) {

    fs.writeFileSync(
        USED_RECEIPTS_FILE,
        JSON.stringify(
            receipts,
            null,
            2
        )
    );
}


// ==================================================
// ЦЕНА КОРЗИНЫ
// ==================================================

function getCartPrice(cart) {

    const count =
        cart.length;

    if (count === 0) {
        return 0;
    }

    if (count === 1) {
        return 990;
    }

    if (count === 2) {
        return 1790;
    }

    if (count === 3) {
        return 2690;
    }

    if (count === 4) {
        return 3680;
    }

    // После 4 книг каждая следующая
    // добавляется по 990 ₸
    return 3680 + (count - 4) * 990;
}


// ==================================================
// ОБЫЧНАЯ ЦЕНА БЕЗ АКЦИИ
// ==================================================

function getRegularPrice(cart) {

    return cart.length * 990;
}


// ==================================================
// ЭКОНОМИЯ
// ==================================================

function getSaving(cart) {

    const regular =
        getRegularPrice(cart);

    const sale =
        getCartPrice(cart);

    return regular - sale;
}


// ==================================================
// ФОРМАТ ЦЕНЫ
// ==================================================

function formatPrice(number) {

    return Number(number)
        .toLocaleString('ru-RU');
}


// ==================================================
// НОРМАЛИЗАЦИЯ
// ==================================================

function normalizeText(text) {

    return String(text || '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function normalizeAmount(value) {

    return String(value || '')
        .replace(/\s/g, '')
        .replace(/₸/g, '')
        .replace(/тг/gi, '')
        .replace(/kzt/gi, '')
        .replace(/,/g, '.')
        .trim();
}


// ==================================================
// СУММА ИЗ ЧЕКА
// ==================================================

function extractAmount(text) {

    const source =
        String(text || '');

    const patterns = [

        /Оплата совершена[\s\S]{0,500}?([\d\s]+(?:[.,]\d{1,2})?)\s*(?:₸|тг|KZT)/i,

        /Сумма[\s:]*([\d\s]+(?:[.,]\d{1,2})?)\s*(?:₸|тг|KZT)/i,

        /Итого[\s:]*([\d\s]+(?:[.,]\d{1,2})?)\s*(?:₸|тг|KZT)/i,

        /([\d\s]+(?:[.,]\d{1,2})?)\s*(?:₸|тг|KZT)/i
    ];

    for (const pattern of patterns) {

        const match =
            source.match(pattern);

        if (match) {

            const amount =
                normalizeAmount(
                    match[1]
                );

            if (amount) {
                return amount;
            }
        }
    }

    return null;
}


// ==================================================
// ПРОВЕРКА ПОЛУЧАТЕЛЯ
// ==================================================

function checkRecipient(text) {

    const normalized =
        normalizeText(text);

    const recipient =
        normalizeText(
            RECIPIENT_NAME
        );

    const bin =
        normalizeText(
            RECIPIENT_BIN
        );

    const hasRecipient =
        normalized.includes(
            recipient
        );

    const hasBin =
        normalized.includes(
            bin
        );

    return (
        hasRecipient &&
        hasBin
    );
}


// ==================================================
// ПРОВЕРКА СТАТУСА
// ==================================================

function checkPaymentStatus(text) {

    const normalized =
        normalizeText(text);

    return (

        normalized.includes(
            'оплата совершена'
        ) ||

        normalized.includes(
            'оплачено'
        ) ||

        normalized.includes(
            'платеж совершен'
        ) ||

        normalized.includes(
            'платёж совершен'
        ) ||

        normalized.includes(
            'успешно'
        ) ||

        normalized.includes(
            'исполнено'
        )
    );
}


// ==================================================
// НОМЕР ЧЕКА
// ==================================================

function extractReceiptNumber(text) {

    const source =
        String(text || '');

    const patterns = [

        /номер чека[:\s№#]*([a-zа-яё0-9\-_]+)/i,

        /чек[:\s№#]*([a-zа-яё0-9\-_]+)/i,

        /receipt[:\s№#]*([a-z0-9\-_]+)/i
    ];

    for (const pattern of patterns) {

        const match =
            source.match(pattern);

        if (match) {
            return match[1];
        }
    }

    return null;
}


// ==================================================
// ПРОВЕРКА PDF
// ==================================================

async function verifyKaspiReceipt(
    filePath,
    expectedAmount
) {

    try {

        const buffer =
            fs.readFileSync(
                filePath
            );

        // Проверяем PDF
        if (
            !buffer
                .slice(0, 4)
                .equals(
                    Buffer.from('%PDF')
                )
        ) {

            return {
                ok: false,
                reason:
                    'Бұл PDF файлы емес.'
            };
        }

        // Читаем PDF
        const data =
            await pdfParse(buffer);

        const text =
            data.text || '';

        if (!text.trim()) {

            return {
                ok: false,
                reason:
                    'Чектің мәтінін оқу мүмкін болмады.'
            };
        }

        // Проверка статуса
        if (
            !checkPaymentStatus(text)
        ) {

            return {
                ok: false,
                reason:
                    'Төлем статусы расталмады.'
            };
        }

        // Проверка получателя
        if (
            !checkRecipient(text)
        ) {

            return {
                ok: false,
                reason:
                    `Чектегі алушы біздің төлем деректерімізге сәйкес келмейді.\n\n` +
                    `Күтілетін алушы: ${RECIPIENT_NAME}\n` +
                    `BIN: ${RECIPIENT_BIN}`
            };
        }

        // Сумма
        const receiptAmount =
            extractAmount(text);

        if (!receiptAmount) {

            return {
                ok: false,
                reason:
                    'Чектен төлем сомасын анықтау мүмкін болмады.'
            };
        }

        const expected =
            normalizeAmount(
                expectedAmount
            );

        if (
            receiptAmount !== expected
        ) {

            return {
                ok: false,
                reason:
                    `Төлем сомасы сәйкес емес.\n\n` +
                    `Күтілгені: ${expected} ₸\n` +
                    `Чектегі: ${receiptAmount} ₸`
            };
        }

        return {
            ok: true,
            text: text,
            amount: receiptAmount,
            receiptNumber:
                extractReceiptNumber(
                    text
                )
        };

    } catch (error) {

        console.error(
            'PDF тексеру қатесі:',
            error
        );

        return {
            ok: false,
            reason:
                'Чекті тексеру кезінде қате болды.'
        };
    }
}


// ==================================================
// START
// ==================================================

bot.start(
    async (ctx) => {

        const userId =
            ctx.from.id;

        if (!carts.has(userId)) {

            carts.set(
                userId,
                []
            );
        }

        // Поддержка при /start прекращается
        supportChats.delete(userId);

        // Удаляем старое меню Bilimland
        await deleteLastMenu(userId);

        const sentMessage =
            await ctx.reply(

                `📚 Bilimland

Қош келдіңіз! 👋

Электронды кітаптарды тиімді бағамен сатып алыңыз.

Қажетті бөлімді таңдаңыз 👇`,

                mainMenu(userId)
            );

        lastMenuMessages.set(
            userId,
            sentMessage.message_id
        );
    }
);


// ==================================================
// КАТАЛОГ
// ==================================================

bot.action(
    'catalog',
    async (ctx) => {

        await ctx.answerCbQuery();

        await safeEditMessageText(

            ctx,

            `📚 *КАТАЛОГ*

Қажетті кітапты таңдаңыз:`,

            {
                parse_mode: 'Markdown',

                ...keyboard([

                    [
                        cb(
                            '📕 14 күнде өз ойымды жазып үйренемін',
                            'book_1'
                        )
                    ],

                    [
                        cb(
                            '📕 Өз сөзіммен мазмұндаймын',
                            'book_2'
                        )
                    ],

                    [
                        cb(
                            '📕 Шығарма жазып үйренемін',
                            'book_3'
                        )
                    ],

                    [
                        cb(
                            '📕 14 күнде сауатты жазамын',
                            'book_4'
                        )
                    ],

                    [
                        cb(
                            '🛒 Себет',
                            'cart'
                        )
                    ],

                    [
                        cb(
                            '🏠 Басты мәзір',
                            'main_menu'
                        )
                    ]

                ])
            }
        );
    }
);


// ==================================================
// КНИГИ
// ==================================================

for (const book of books) {

    bot.action(
        `book_${book.id}`,
        async (ctx) => {

            await ctx.answerCbQuery();

            const userId =
                ctx.from.id;

            const cart =
                carts.get(userId) || [];

            const alreadyAdded =
                cart.includes(book.id);

            const buttonText =
                alreadyAdded
                    ? '✅ Кітап себетте'
                    : '🛒 Себетке қосу';

            await safeEditMessageText(

                ctx,

                `📕 *${book.title}*

💰 Бағасы: *${formatPrice(book.price)} ₸*

${
    alreadyAdded
        ? '✅ Бұл кітап қазірдің өзінде себетіңізде.'
        : 'Кітапты себетке қосып, сатып алуға болады.'
}`,

                {
                    parse_mode: 'Markdown',

                    ...keyboard([

                        [
                            cb(
                                buttonText,
                                `add_${book.id}`
                            )
                        ],

                        [
                            cb(
                                '🛒 Себетті көру',
                                'cart'
                            )
                        ],

                        [
                            cb(
                                '⬅️ Каталог',
                                'catalog'
                            )
                        ],

                        [
                            cb(
                                '🏠 Басты мәзір',
                                'main_menu'
                            )
                        ]

                    ])
                }
            );
        }
    );
}


// ==================================================
// ДОБАВИТЬ В КОРЗИНУ
// ==================================================

for (const book of books) {

    bot.action(
        `add_${book.id}`,
        async (ctx) => {

            const userId =
                ctx.from.id;

            if (!carts.has(userId)) {

                carts.set(
                    userId,
                    []
                );
            }

            const cart =
                carts.get(userId);

            // Не добавляем одну книгу дважды
            if (
                cart.includes(book.id)
            ) {

                await ctx.answerCbQuery(
                    'Бұл кітап себетте бар! 🛒',
                    {
                        show_alert: true
                    }
                );

                await showCart(ctx);

                return;
            }

            cart.push(
                book.id
            );

            await ctx.answerCbQuery(
                'Кітап себетке қосылды! 🛒'
            );

            // Сразу показываем всю корзину
            await showCart(ctx);
        }
    );
}


// ==================================================
// ПОКАЗ КОРЗИНЫ
// ==================================================

async function showCart(ctx) {

    const userId =
        ctx.from.id;

    const cart =
        carts.get(userId) || [];


    // ==================================================
    // ПУСТАЯ КОРЗИНА
    // ==================================================

    if (cart.length === 0) {

        await safeEditMessageText(

            ctx,

            `🛒 *СЕБЕТ*

Себетіңіз бос.

📚 Каталогтан кітап таңдап,
себетке қосыңыз.`,

            {
                parse_mode: 'Markdown',

                ...keyboard([

                    [
                        cb(
                            '📚 Каталог',
                            'catalog'
                        )
                    ],

                    [
                        cb(
                            '🎁 Акциялар',
                            'sale'
                        )
                    ],

                    [
                        cb(
                            '🏠 Басты мәзір',
                            'main_menu'
                        )
                    ]

                ])
            }
        );

        return;
    }


    // ==================================================
    // КОРЗИНА С ТОВАРАМИ
    // ==================================================

    let messageText =
        `🛒 *СЕБЕТІҢІЗ*\n\n`;

    const rows = [];

    for (const bookId of cart) {

        const book =
            books.find(
                item =>
                    item.id === bookId
            );

        if (!book) {
            continue;
        }

        messageText +=
            `📕 ${book.title}\n`;
    }


    const regular =
        getRegularPrice(cart);

    const total =
        getCartPrice(cart);

    const saving =
        getSaving(cart);


    messageText +=
        `\n📚 Кітап саны: *${cart.length}*`;

    messageText +=
        `\n💰 Қалыпты баға: *${formatPrice(regular)} ₸*`;

    if (saving > 0) {

        messageText +=
            `\n🔥 Акциялық баға: *${formatPrice(total)} ₸*`;

        messageText +=
            `\n💸 Үнемдеу: *${formatPrice(saving)} ₸*`;

    } else {

        messageText +=
            `\n💳 Бағасы: *${formatPrice(total)} ₸*`;
    }


    // Кнопки удаления
    for (const bookId of cart) {

        const book =
            books.find(
                item =>
                    item.id === bookId
            );

        if (!book) {
            continue;
        }

        rows.push([

            cb(
                `❌ ${book.title}`,
                `remove_${book.id}`
            )

        ]);
    }


    rows.push([

        cb(
            `💳 Сатып алу — ${formatPrice(total)} ₸`,
            'checkout'
        )

    ]);

    rows.push([

        cb(
            '📚 Каталог',
            'catalog'
        ),

        cb(
            '🎁 Акциялар',
            'sale'
        )

    ]);

    rows.push([

        cb(
            '🏠 Басты мәзір',
            'main_menu'
        )

    ]);


    await safeEditMessageText(

        ctx,

        messageText,

        {
            parse_mode: 'Markdown',

            ...keyboard(rows)
        }
    );
}


// ==================================================
// КОРЗИНА
// ==================================================

bot.action(
    'cart',
    async (ctx) => {

        await ctx.answerCbQuery();

        await showCart(ctx);
    }
);


// ==================================================
// УДАЛЕНИЕ ИЗ КОРЗИНЫ
// ==================================================

bot.action(
    /^remove_(\d+)$/,
    async (ctx) => {

        const userId =
            ctx.from.id;

        const bookId =
            Number(
                ctx.match[1]
            );

        const cart =
            carts.get(userId) || [];

        const index =
            cart.indexOf(bookId);

        if (index !== -1) {

            cart.splice(
                index,
                1
            );
        }

        carts.set(
            userId,
            cart
        );

        await ctx.answerCbQuery(
            'Кітап себеттен алынды.'
        );

        await showCart(ctx);
    }
);


// ==================================================
// ПОКУПКА / ОПЛАТА
// ==================================================

bot.action(
    'checkout',
    async (ctx) => {

        const userId =
            ctx.from.id;

        const cart =
            carts.get(userId) || [];


        if (cart.length === 0) {

            await ctx.answerCbQuery(
                'Себет бос!',
                {
                    show_alert: true
                }
            );

            return;
        }


        await ctx.answerCbQuery();


        const total =
            getCartPrice(cart);

        const regular =
            getRegularPrice(cart);

        const saving =
            getSaving(cart);


        pendingPayments.set(

            userId,

            {
                amount: total,
                cart: [...cart]
            }

        );


        let priceText =
            `🔥 Акциялық баға: *${formatPrice(total)} ₸*`;

        if (saving > 0) {

            priceText +=
                `\n💸 Үнемдеу: *${formatPrice(saving)} ₸*`;

            priceText +=
                `\n\nҚалыпты баға: ${formatPrice(regular)} ₸`;
        }


        await safeEditMessageText(

            ctx,

            `💳 *САТЫП АЛУ*

📚 Кітап саны: *${cart.length}*

${priceText}

💳 *Төлем жасау үшін төмендегі батырманы басыңыз.*

1️⃣ Kaspi арқылы төлем жасаңыз.
2️⃣ Төлемнен кейін Kaspi чегін PDF форматында жүктеп алыңыз.
3️⃣ Осы ботқа PDF чекті жіберіңіз.

⚠️ *Чек PDF форматында болуы керек.*`,

            {
                parse_mode: 'Markdown',

                ...keyboard([

                    [
                        urlButton(
                            '💳 Kaspi арқылы төлеу',
                            KASPI_PAYMENT_URL
                        )
                    ],

                    [
                        cb(
                            '📄 Чекті жіберу',
                            'send_receipt'
                        )
                    ],

                    [
                        cb(
                            '🛒 Себет',
                            'cart'
                        )
                    ],

                    [
                        cb(
                            '🏠 Басты мәзір',
                            'main_menu'
                        )
                    ]

                ])
            }
        );
    }
);


// ==================================================
// ОТПРАВИТЬ ЧЕК
// ==================================================

bot.action(
    'send_receipt',
    async (ctx) => {

        await ctx.answerCbQuery();

        const userId =
            ctx.from.id;

        const payment =
            pendingPayments.get(
                userId
            );


        if (!payment) {

            await ctx.reply(
                `❌ Белсенді төлем табылмады.

Алдымен кітапты таңдап, төлемге өтіңіз.`
            );

            return;
        }


        await ctx.reply(

            `📄 *ЧЕКТІ ЖІБЕРУ*

Kaspi арқылы төлем жасағаннан кейін төлем чегін осы жерге *PDF форматында* жіберіңіз.

⚠️ Тек PDF чек қабылданады.`,

            {
                parse_mode: 'Markdown'
            }
        );
    }
);


// ==================================================
// PDF ЧЕК
// ==================================================

bot.on(
    'document',
    async (ctx) => {

        const userId =
            ctx.from.id;

        const payment =
            pendingPayments.get(
                userId
            );


        if (!payment) {
            return;
        }


        const document =
            ctx.message.document;

        const fileName =
            document.file_name || '';


        // ==================================================
        // ПРОВЕРКА PDF
        // ==================================================

        if (
            !fileName
                .toLowerCase()
                .endsWith('.pdf')
        ) {

            await ctx.reply(

                `❌ Қате.

Чекті тек *PDF форматында* жіберіңіз.`,

                {
                    parse_mode: 'Markdown'
                }
            );

            return;
        }


        let tempFile = null;


        try {

            await ctx.reply(
                `⏳ Чек тексерілуде...

Бірнеше секунд күтіңіз.`
            );


            // ==================================================
            // ПОЛУЧАЕМ ФАЙЛ
            // ==================================================

            const file =
                await ctx.telegram.getFile(
                    document.file_id
                );


            const fileUrl =
                `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;


            const response =
                await fetch(fileUrl);


            if (!response.ok) {

                throw new Error(
                    'PDF жүктелмеді'
                );
            }


            const arrayBuffer =
                await response.arrayBuffer();


            const buffer =
                Buffer.from(
                    arrayBuffer
                );


            // ==================================================
            // HASH
            // ==================================================

            const hash =
                crypto
                    .createHash('sha256')
                    .update(buffer)
                    .digest('hex');


            const usedReceipts =
                getUsedReceipts();


            if (
                usedReceipts.includes(hash)
            ) {

                await ctx.reply(

                    `❌ *Бұл чек бұрын қолданылған.*

Бір чекті бірнеше рет қолдануға болмайды.`,

                    {
                        parse_mode: 'Markdown'
                    }
                );

                return;
            }


            // ==================================================
            // СОХРАНЕНИЕ
            // ==================================================

            tempFile =
                path.join(

                    TEMP_RECEIPTS_DIR,

                    `${userId}_${Date.now()}.pdf`

                );


            fs.writeFileSync(
                tempFile,
                buffer
            );


            // ==================================================
            // ПРОВЕРКА
            // ==================================================

            const verification =
                await verifyKaspiReceipt(

                    tempFile,

                    payment.amount

                );


            if (!verification.ok) {

                await ctx.reply(

                    `❌ *Төлем расталмады.*

${verification.reason}

Чекті қайта тексеріп, дұрыс PDF чекті жіберіңіз.`,

                    {
                        parse_mode: 'Markdown'
                    }
                );

                return;
            }


            // ==================================================
            // СОХРАНЯЕМ ЧЕК
            // ==================================================

            usedReceipts.push(
                hash
            );

            saveUsedReceipts(
                usedReceipts
            );


            // ==================================================
            // ОПЛАТА ПОДТВЕРЖДЕНА
            // ==================================================

            await ctx.reply(

                `✅ *ТӨЛЕМ СӘТТІ РАСТАЛДЫ!*

🎉 Рақмет! Сатып алған кітаптарыңыз дайын.

📚 Электронды кітаптарыңыз қазір жіберіледі.`,

                {
                    parse_mode: 'Markdown'
                }
            );


            // ==================================================
            // ОТПРАВЛЯЕМ КНИГИ
            // ==================================================

            for (
                const bookId
                of payment.cart
            ) {

                const book =
                    books.find(
                        item =>
                            item.id === bookId
                    );


                if (!book) {
                    continue;
                }


                const bookPath =
                    path.join(
                        BOOKS_DIR,
                        book.file
                    );


                if (
                    !fs.existsSync(
                        bookPath
                    )
                ) {

                    await ctx.reply(

                        `❌ ${book.title}

Файл табылмады. Менеджерге хабарласыңыз.`

                    );

                    continue;
                }


                await ctx.replyWithDocument(

                    {
                        source: bookPath
                    },

                    {
                        caption:
                            `📕 ${book.title}\n\n📚 Bilimland`
                    }

                );
            }


            // ==================================================
            // ОЧИСТКА
            // ==================================================

            carts.set(
                userId,
                []
            );

            pendingPayments.delete(
                userId
            );


            // ==================================================
            // ПОСЛЕ ПОКУПКИ
            // ==================================================

            let afterPurchaseText =

                `🎉 *Сатып алғаныңызға рақмет!*

📚 Кітаптарыңызды жағымды оқуды тілейміз!

❤️ Bilimland-ды таңдағаныңызға рақмет!`;


            const afterPurchaseButtons = [];


            // WhatsApp-группа
            if (
                WHATSAPP_GROUP_URL
            ) {

                afterPurchaseButtons.push([

                    urlButton(
                        '💬 WhatsApp тобына қосылу',
                        WHATSAPP_GROUP_URL
                    )

                ]);
            }


            afterPurchaseButtons.push([

                cb(
                    '🏠 Басты мәзірге',
                    'main_menu'
                )

            ]);


            await ctx.reply(

                afterPurchaseText,

                keyboard(
                    afterPurchaseButtons
                )

            );


        } catch (error) {

            console.error(
                'PDF error:',
                error
            );


            await ctx.reply(

                `❌ Чекті өңдеу кезінде қате пайда болды.

Қайтадан PDF чек жіберіп көріңіз.`

            );


        } finally {

            if (
                tempFile &&
                fs.existsSync(
                    tempFile
                )
            ) {

                try {

                    fs.unlinkSync(
                        tempFile
                    );

                } catch {}
            }
        }
    }
);


// ==================================================
// АКЦИЯЛАР
// ==================================================

bot.action(
    'sale',
    async (ctx) => {

        await ctx.answerCbQuery();

        const price1 =
            getCartPrice([1]);

        const price2 =
            getCartPrice([1, 2]);

        const price3 =
            getCartPrice([1, 2, 3]);

        const price4 =
            getCartPrice([1, 2, 3, 4]);


        await safeEditMessageText(

            ctx,

            `🎁 *АКЦИЯЛАР*

📕 *1 кітап*
💰 ${formatPrice(price1)} ₸
Акция жоқ — қалыпты баға.

🔥 *2 кітап*
💰 ${formatPrice(price2)} ₸
💸 Үнемдеу: ${formatPrice(1980 - price2)} ₸

⭐ *3 кітап*
💰 ${formatPrice(price3)} ₸
💸 Үнемдеу: ${formatPrice(2970 - price3)} ₸

💎 *4 кітап*
💰 ${formatPrice(price4)} ₸
💸 Үнемдеу: ${formatPrice(3960 - price4)} ₸

📚 *5 және одан көп кітап*
4 кітапқа арналған акция сақталады,
әр қосымша кітап — 990 ₸.

🎉 Кітап саны көбейген сайын,
акция автоматты түрде есептеледі.

Төлем кезінде бот сіздің нақты соманы өзі көрсетеді.`,

            {
                parse_mode: 'Markdown',

                ...keyboard([

                    [
                        cb(
                            '📚 Каталог',
                            'catalog'
                        )
                    ],

                    [
                        cb(
                            '🛒 Себет',
                            'cart'
                        )
                    ],

                    [
                        cb(
                            '🏠 Басты мәзір',
                            'main_menu'
                        )
                    ]

                ])
            }
        );
    }
);


// ==================================================
// ПОДДЕРЖКА
// ==================================================

bot.action(
    'support',
    async (ctx) => {

        await ctx.answerCbQuery();

        await safeEditMessageText(

            ctx,

            `❓ *ҚОЛДАУ*

Сұрағыңыз немесе мәселеңіз болса,
тікелей менеджерге жазыңыз.

Менеджер сізге мүмкіндігінше тез жауап береді. 👇`,

            {
                parse_mode: 'Markdown',

                ...keyboard([

                    [
                        cb(
                            '💬 Менеджерге жазу',
                            'start_support'
                        )
                    ],

                    [
                        cb(
                            '🏠 Басты мәзір',
                            'main_menu'
                        )
                    ]

                ])
            }
        );
    }
);


// ==================================================
// НАЧАТЬ ПОДДЕРЖКУ
// ==================================================

bot.action(
    'start_support',
    async (ctx) => {

        const userId =
            ctx.from.id;

        supportChats.add(
            userId
        );

        await ctx.answerCbQuery();

        await ctx.reply(

            `💬 *МЕНЕДЖЕРГЕ ЖАЗУ*

Сұрағыңызды келесі хабарламада жазыңыз.

📩 Хабарламаңыз менеджерге жіберіледі,
ал менеджердің жауабы осы жерге келеді.`,

            {
                parse_mode: 'Markdown',

                ...keyboard([

                    [
                        cb(
                            '❌ Сұрақты тоқтату',
                            'stop_support'
                        )
                    ]

                ])
            }
        );
    }
);


// ==================================================
// ОСТАНОВИТЬ ПОДДЕРЖКУ
// ==================================================

bot.action(
    'stop_support',
    async (ctx) => {

        const userId =
            ctx.from.id;

        supportChats.delete(
            userId
        );

        await ctx.answerCbQuery();

        await ctx.reply(

            `✅ Қолдау бөлімі жабылды.`,

            keyboard([

                [
                    cb(
                        '🏠 Басты мәзір',
                        'main_menu'
                    )
                ]

            ])
        );
    }
);


// ==================================================
// ТЕКСТОВЫЕ СООБЩЕНИЯ
// ==================================================

bot.on(
    'text',
    async (ctx) => {

        const userId =
            ctx.from.id;

        const messageText =
            ctx.message.text;


        // ==================================================
        // ОТВЕТ МЕНЕДЖЕРА
        // ==================================================

        if (
            userId === MANAGER_ID &&
            managerReplyTo
        ) {

            const customerId =
                managerReplyTo;


            try {

                await bot.telegram.sendMessage(

                    customerId,

                    `💬 Жауап менеджерден:

${messageText}`

                );


                await ctx.reply(
                    `✅ Жауап клиентке жіберілді.`
                );


                managerReplyTo =
                    null;


            } catch (error) {

                console.error(
                    'Manager reply error:',
                    error
                );


                await ctx.reply(
                    `❌ Клиентке хабарлама жіберу мүмкін болмады.`
                );
            }

            return;
        }


        // ==================================================
        // КЛИЕНТ НЕ В ПОДДЕРЖКЕ
        // ==================================================

        if (
            !supportChats.has(userId)
        ) {
            return;
        }


        const username =
            ctx.from.username
                ? `@${ctx.from.username}`
                : 'жоқ';


        const firstName =
            ctx.from.first_name || '';


        const lastName =
            ctx.from.last_name || '';


        const customerName =
            `${firstName} ${lastName}`.trim();


        // ==================================================
        // ОТПРАВЛЯЕМ МЕНЕДЖЕРУ
        // ==================================================

        await bot.telegram.sendMessage(

            MANAGER_ID,

            `📩 ЖАҢА СҰРАҚ

👤 Клиент: ${customerName || 'Белгісіз'}
🔹 Username: ${username}
🆔 ID: ${userId}

💬 Хабарлама:
${messageText}`,

            {
                ...keyboard([

                    [
                        cb(
                            '💬 Жауап беру',
                            `manager_reply_${userId}`
                        )
                    ]

                ])
            }
        );


        await ctx.reply(

            `✅ Хабарламаңыз менеджерге жіберілді.

Жауапты күтіңіз.`

        );
    }
);


// ==================================================
// ОТВЕТ МЕНЕДЖЕРА
// ==================================================

bot.action(

    /^manager_reply_(\d+)$/,

    async (ctx) => {

        if (
            ctx.from.id !== MANAGER_ID
        ) {

            await ctx.answerCbQuery(

                'Бұл батырма менеджерге арналған.',

                {
                    show_alert: true
                }

            );

            return;
        }


        const customerId =
            Number(
                ctx.match[1]
            );


        managerReplyTo =
            customerId;


        await ctx.answerCbQuery();


        await ctx.reply(

            `💬 Клиентке жауап беру үшін келесі хабарламаңызды жазыңыз.`

        );
    }
);


// ==================================================
// ГЛАВНОЕ МЕНЮ
// ==================================================

bot.action(
    'main_menu',
    async (ctx) => {

        const userId =
            ctx.from.id;

        supportChats.delete(
            userId
        );

        await ctx.answerCbQuery();

        await safeEditMessageText(

            ctx,

            `📚 Bilimland 

Қош келдіңіз! 👋

Электронды кітаптарды тиімді бағамен сатып алыңыз.

Қажетті бөлімді таңдаңыз 👇`,

            mainMenu(userId)

        );
    }
);


// ==================================================
// ОШИБКИ
// ==================================================

bot.catch(
    (error, ctx) => {

        console.error(
            'BOT ERROR:',
            error
        );

        console.error(
            'UPDATE:',
            ctx.update
        );
    }
);


// ==================================================
// ЗАПУСК
// ==================================================

bot.launch();

console.log(
    '================================'
);

console.log(
    '📚 Bilimland іске қосылды!'
);

console.log(
    'Kaspi URL:',
    KASPI_PAYMENT_URL
);

console.log(
    'Бот жұмыс істеп тұр.'
);

console.log(
    '================================'
);


// ==================================================
// ОСТАНОВКА
// ==================================================

process.once(
    'SIGINT',
    () => bot.stop('SIGINT')
);

process.once(
    'SIGTERM',
    () => bot.stop('SIGTERM')
);
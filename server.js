const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // Можна змінити через змінну оточення

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Директорії для зберігання
const DATA_DIR = path.join(__dirname, 'data');
const FILES_DIR = path.join(__dirname, 'files');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ініціалізація директорій та БД
async function initializeStorage() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.mkdir(FILES_DIR, { recursive: true });
        
        try {
            await fs.access(DB_FILE);
            console.log('✅ База даних знайдена');
        } catch {
            const initialDb = {
                users: [
                    { username: 'admin', password: 'password', name: 'Адміністратор' }
                ],
                files: []
            };
            await fs.writeFile(DB_FILE, JSON.stringify(initialDb, null, 2));
            console.log('✅ База даних створена');
        }
        
        console.log('✅ Сховище ініціалізовано');
    } catch (error) {
        console.error('❌ Помилка ініціалізації:', error);
    }
}

// Читання БД
async function readDatabase() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Помилка читання БД:', error);
        return { users: [], files: [] };
    }
}

// Запис БД
async function writeDatabase(data) {
    try {
        await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('Помилка запису БД:', error);
        return false;
    }
}

// Збереження файлу на диск
async function saveFileToDisk(fileId, fileData, fileType) {
    try {
        const fileName = `${fileId}`;
        const filePath = path.join(FILES_DIR, fileName);
        
        if (fileType.startsWith('image/')) {
            // Для зображень зберігаємо як base64
            await fs.writeFile(filePath, fileData, 'utf8');
        } else {
            // Для текстових файлів
            await fs.writeFile(filePath, fileData, 'utf8');
        }
        
        return fileName;
    } catch (error) {
        console.error('Помилка збереження файлу:', error);
        throw error;
    }
}

// Читання файлу з диску
async function readFileFromDisk(fileName, fileType) {
    try {
        const filePath = path.join(FILES_DIR, fileName);
        return await fs.readFile(filePath, 'utf8');
    } catch (error) {
        console.error('Помилка читання файлу:', error);
        throw error;
    }
}

// Видалення файлу з диску
async function deleteFileFromDisk(fileName) {
    try {
        const filePath = path.join(FILES_DIR, fileName);
        await fs.unlink(filePath);
        return true;
    } catch (error) {
        console.error('Помилка видалення файлу:', error);
        return false;
    }
}

// Перевірка існування файлу
async function fileExists(fileName) {
    try {
        const filePath = path.join(FILES_DIR, fileName);
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// ============ API ENDPOINTS ============

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Сервер працює',
        timestamp: new Date().toISOString(),
        storage: {
            dataDir: DATA_DIR,
            filesDir: FILES_DIR
        }
    });
});

// Авторизація
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ 
            success: false, 
            error: 'Username та password обов\'язкові' 
        });
    }
    
    const db = await readDatabase();
    const user = db.users.find(u => u.username === username && u.password === password);
    
    if (user) {
        console.log(`✅ Користувач ${username} увійшов в систему`);
        res.json({ 
            success: true, 
            user: { 
                username: user.username, 
                name: user.name 
            } 
        });
    } else {
        console.log(`❌ Невдала спроба входу: ${username}`);
        res.status(401).json({ 
            success: false, 
            error: 'Невірні дані для входу' 
        });
    }
});

// Отримання списку файлів (тільки метадані)
app.get('/api/files', async (req, res) => {
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId обов\'язковий' 
        });
    }
    
    const db = await readDatabase();
    const userFiles = db.files.filter(f => f.userId === userId);
    
    // Перевіряємо існування файлів на диску
    const filesWithStatus = await Promise.all(
        userFiles.map(async (f) => {
            const exists = await fileExists(f.fileName);
            return {
                id: f.id,
                userId: f.userId,
                name: f.name,
                type: f.type,
                size: f.size,
                uploader: f.uploader,
                createdDate: f.createdDate,
                modifiedDate: f.modifiedDate,
                fileName: f.fileName,
                fileExists: exists
            };
        })
    );
    
    console.log(`📂 Отримано список файлів для користувача ${userId}: ${filesWithStatus.length} файлів`);
    
    res.json({ 
        success: true, 
        files: filesWithStatus,
        count: filesWithStatus.length
    });
});

// Отримання конкретного файлу з вмістом
app.get('/api/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId обов\'язковий' 
        });
    }
    
    const db = await readDatabase();
    const file = db.files.find(f => f.id === fileId && f.userId === userId);
    
    if (!file) {
        console.log(`❌ Файл не знайдено: ${fileId}`);
        return res.status(404).json({ 
            success: false, 
            error: 'Файл не знайдено' 
        });
    }
    
    try {
        // Читаємо вміст файлу з диску
        const fileData = await readFileFromDisk(file.fileName, file.type);
        
        console.log(`📥 Файл ${file.name} завантажено для користувача ${userId}`);
        
        res.json({
            success: true,
            file: {
                ...file,
                data: fileData
            }
        });
    } catch (error) {
        console.error(`❌ Помилка читання файлу ${file.name}:`, error);
        res.status(500).json({
            success: false,
            error: 'Помилка читання файлу'
        });
    }
});

// Завантаження файлу
app.post('/api/files', async (req, res) => {
    const { userId, id, name, type, size, uploader, data } = req.body;
    
    if (!userId || !name || !data) {
        return res.status(400).json({ 
            success: false, 
            error: 'Відсутні обов\'язкові поля' 
        });
    }
    
    // Валідація типу файлу
    const allowedExtensions = ['.js', '.png'];
    const ext = '.' + name.split('.').pop().toLowerCase();
    
    if (!allowedExtensions.includes(ext)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Непідтримуваний тип файлу. Дозволені: .js, .png' 
        });
    }
    
    try {
        const db = await readDatabase();
        
        // Перевіряємо, чи файл вже існує
        const existingFileIndex = db.files.findIndex(f => f.id === id && f.userId === userId);
        
        const fileId = id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const fileName = await saveFileToDisk(fileId, data, type);
        
        const fileMetadata = {
            id: fileId,
            userId,
            name,
            type: type || 'application/octet-stream',
            size: size || data.length,
            uploader: uploader || 'Unknown',
            fileName,
            createdDate: existingFileIndex !== -1 ? db.files[existingFileIndex].createdDate : new Date().toISOString(),
            modifiedDate: new Date().toISOString()
        };
        
        if (existingFileIndex !== -1) {
            // Оновлюємо існуючий файл
            const oldFileName = db.files[existingFileIndex].fileName;
            
            // Видаляємо старий файл якщо він інший
            if (oldFileName !== fileName) {
                await deleteFileFromDisk(oldFileName);
            }
            
            db.files[existingFileIndex] = fileMetadata;
            console.log(`🔄 Файл ${name} оновлено для користувача ${userId}`);
        } else {
            // Додаємо новий файл
            db.files.push(fileMetadata);
            console.log(`✅ Новий файл ${name} додано для користувача ${userId}`);
        }
        
        await writeDatabase(db);
        
        res.json({ 
            success: true, 
            message: 'Файл успішно завантажено',
            file: fileMetadata
        });
    } catch (error) {
        console.error('❌ Помилка завантаження файлу:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Помилка сервера при завантаженні файлу' 
        });
    }
});

// Видалення файлу
app.delete('/api/files/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId обов\'язковий' 
        });
    }
    
    const db = await readDatabase();
    const fileIndex = db.files.findIndex(f => f.id === fileId && f.userId === userId);
    
    if (fileIndex === -1) {
        console.log(`❌ Файл для видалення не знайдено: ${fileId}`);
        return res.status(404).json({ 
            success: false, 
            error: 'Файл не знайдено' 
        });
    }
    
    try {
        // Видаляємо файл з диску
        const fileName = db.files[fileIndex].fileName;
        const deleted = await deleteFileFromDisk(fileName);
        
        if (!deleted) {
            console.log(`⚠️ Файл ${fileName} не знайдено на диску, але буде видалено з БД`);
        }
        
        const deletedFile = db.files[fileIndex];
        
        // Видаляємо метадані з БД
        db.files.splice(fileIndex, 1);
        await writeDatabase(db);
        
        console.log(`🗑️ Файл ${deletedFile.name} видалено для користувача ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Файл успішно видалено' 
        });
    } catch (error) {
        console.error('❌ Помилка видалення файлу:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Помилка видалення файлу' 
        });
    }
});

// Синхронізація - отримання повної інформації про файли
app.post('/api/sync', async (req, res) => {
    const { userId, localFileIds } = req.body;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId обов\'язковий' 
        });
    }
    
    try {
        const db = await readDatabase();
        const userFiles = db.files.filter(f => f.userId === userId);
        
        // Отримуємо повну інформацію про файли з вмістом
        const filesWithData = await Promise.all(
            userFiles.map(async (file) => {
                try {
                    const data = await readFileFromDisk(file.fileName, file.type);
                    return { ...file, data };
                } catch (error) {
                    console.error(`❌ Помилка читання файлу ${file.name}:`, error);
                    return null;
                }
            })
        );
        
        const validFiles = filesWithData.filter(f => f !== null);
        
        console.log(`🔄 Синхронізація для користувача ${userId}: ${validFiles.length} файлів`);
        
        res.json({
            success: true,
            files: validFiles,
            localFileIds: localFileIds || []
        });
    } catch (error) {
        console.error('❌ Помилка синхронізації:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка синхронізації'
        });
    }
});

// Статистика
app.get('/api/stats', async (req, res) => {
    const { userId } = req.query;
    
    try {
        const db = await readDatabase();
        const userFiles = userId ? db.files.filter(f => f.userId === userId) : db.files;
        
        const stats = {
            totalFiles: userFiles.length,
            totalSize: userFiles.reduce((sum, f) => sum + (f.size || 0), 0),
            fileTypes: {},
            uploadsByUser: {}
        };
        
        userFiles.forEach(file => {
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            stats.fileTypes[ext] = (stats.fileTypes[ext] || 0) + 1;
            stats.uploadsByUser[file.uploader] = (stats.uploadsByUser[file.uploader] || 0) + 1;
        });
        
        console.log(`📊 Статистика запитана для ${userId || 'всіх користувачів'}`);
        
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('❌ Помилка отримання статистики:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка отримання статистики'
        });
    }
});

// Масове завантаження файлів
app.post('/api/files/bulk', async (req, res) => {
    const { userId, files } = req.body;
    
    if (!userId || !files || !Array.isArray(files)) {
        return res.status(400).json({ 
            success: false, 
            error: 'Відсутні обов\'язкові поля або невірний формат' 
        });
    }
    
    const results = [];
    const db = await readDatabase();
    
    for (const file of files) {
        try {
            const { id, name, type, size, uploader, data } = file;
            
            // Валідація
            const ext = '.' + name.split('.').pop().toLowerCase();
            if (!['.js', '.png'].includes(ext)) {
                results.push({ success: false, name, error: 'Непідтримуваний тип' });
                continue;
            }
            
            const fileId = id || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const fileName = await saveFileToDisk(fileId, data, type);
            
            const fileMetadata = {
                id: fileId,
                userId,
                name,
                type: type || 'application/octet-stream',
                size: size || data.length,
                uploader: uploader || 'Unknown',
                fileName,
                createdDate: new Date().toISOString(),
                modifiedDate: new Date().toISOString()
            };
            
            const existingIndex = db.files.findIndex(f => f.id === fileId && f.userId === userId);
            
            if (existingIndex !== -1) {
                db.files[existingIndex] = fileMetadata;
            } else {
                db.files.push(fileMetadata);
            }
            
            results.push({ success: true, name, id: fileId });
        } catch (error) {
            results.push({ success: false, name: file.name, error: error.message });
        }
    }
    
    await writeDatabase(db);
    
    const successCount = results.filter(r => r.success).length;
    console.log(`📦 Масове завантаження для ${userId}: ${successCount}/${files.length} успішно`);
    
    res.json({
        success: true,
        results,
        totalProcessed: files.length,
        successCount
    });
});

// Очищення файлів користувача
app.delete('/api/files', async (req, res) => {
    const { userId } = req.query;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId обов\'язковий' 
        });
    }
    
    try {
        const db = await readDatabase();
        const userFiles = db.files.filter(f => f.userId === userId);
        
        // Видаляємо файли з диску
        for (const file of userFiles) {
            await deleteFileFromDisk(file.fileName);
        }
        
        // Видаляємо метадані з БД
        db.files = db.files.filter(f => f.userId !== userId);
        await writeDatabase(db);
        
        console.log(`🗑️ Очищено всі файли для користувача ${userId}: ${userFiles.length} файлів`);
        
        res.json({
            success: true,
            message: 'Всі файли успішно видалено',
            deletedCount: userFiles.length
        });
    } catch (error) {
        console.error('❌ Помилка очищення файлів:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка очищення файлів'
        });
    }
});

// Пошук файлів
app.get('/api/files/search', async (req, res) => {
    const { userId, query } = req.query;
    
    if (!userId || !query) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId та query обов\'язкові' 
        });
    }
    
    try {
        const db = await readDatabase();
        const userFiles = db.files.filter(f => f.userId === userId);
        
        const lowerQuery = query.toLowerCase();
        const searchResults = userFiles.filter(file =>
            file.name.toLowerCase().includes(lowerQuery) ||
            file.uploader.toLowerCase().includes(lowerQuery) ||
            file.type.toLowerCase().includes(lowerQuery)
        );
        
        console.log(`🔍 Пошук "${query}" для ${userId}: знайдено ${searchResults.length} файлів`);
        
        res.json({
            success: true,
            files: searchResults,
            count: searchResults.length,
            query
        });
    } catch (error) {
        console.error('❌ Помилка пошуку:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка пошуку'
        });
    }
});

// Експорт списку файлів
app.get('/api/export', async (req, res) => {
    const { userId, format } = req.query;
    
    if (!userId) {
        return res.status(400).json({ 
            success: false, 
            error: 'userId обов\'язковий' 
        });
    }
    
    try {
        const db = await readDatabase();
        const userFiles = db.files.filter(f => f.userId === userId);
        
        if (format === 'csv') {
            // Експорт у CSV
            const csvHeader = 'ID,Name,Type,Size,Uploader,Created,Modified\n';
            const csvRows = userFiles.map(f => 
                `${f.id},${f.name},${f.type},${f.size},${f.uploader},${f.createdDate},${f.modifiedDate}`
            ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="files_${userId}_${Date.now()}.csv"`);
            res.send(csvHeader + csvRows);
        } else {
            // Експорт у JSON (за замовчуванням)
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="files_${userId}_${Date.now()}.json"`);
            res.json({
                userId,
                exportDate: new Date().toISOString(),
                filesCount: userFiles.length,
                files: userFiles
            });
        }
        
        console.log(`📤 Експорт файлів для ${userId} у форматі ${format || 'json'}`);
    } catch (error) {
        console.error('❌ Помилка експорту:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка експорту'
        });
    }
});

// Отримання інформації про зберігання
app.get('/api/storage/info', async (req, res) => {
    try {
        const db = await readDatabase();
        
        // Підрахунок використаного місця
        let totalSize = 0;
        const fileSizes = {};
        
        for (const file of db.files) {
            totalSize += file.size || 0;
            fileSizes[file.userId] = (fileSizes[file.userId] || 0) + (file.size || 0);
        }
        
        // Інформація про файлову систему
        const files = await fs.readdir(FILES_DIR);
        
        res.json({
            success: true,
            storage: {
                totalFiles: db.files.length,
                totalSize,
                totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
                physicalFiles: files.length,
                usersSizes: fileSizes,
                dataDirectory: DATA_DIR,
                filesDirectory: FILES_DIR
            }
        });
    } catch (error) {
        console.error('❌ Помилка отримання інформації про сховище:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка отримання інформації'
        });
    }
});

// Перевірка цілісності даних
app.get('/api/storage/integrity', async (req, res) => {
    try {
        const db = await readDatabase();
        const issues = [];
        
        // Перевіряємо, чи існують файли на диску
        for (const file of db.files) {
            const exists = await fileExists(file.fileName);
            if (!exists) {
                issues.push({
                    type: 'missing_file',
                    fileId: file.id,
                    fileName: file.name,
                    message: 'Файл в БД, але відсутній на диску'
                });
            }
        }
        
        // Перевіряємо файли на диску без запису в БД
        const diskFiles = await fs.readdir(FILES_DIR);
        const dbFileNames = new Set(db.files.map(f => f.fileName));
        
        for (const diskFile of diskFiles) {
            if (!dbFileNames.has(diskFile)) {
                issues.push({
                    type: 'orphan_file',
                    fileName: diskFile,
                    message: 'Файл на диску без запису в БД'
                });
            }
        }
        
        console.log(`🔍 Перевірка цілісності: знайдено ${issues.length} проблем`);
        
        res.json({
            success: true,
            integrity: {
                isHealthy: issues.length === 0,
                totalFiles: db.files.length,
                diskFiles: diskFiles.length,
                issuesCount: issues.length,
                issues
            }
        });
    } catch (error) {
        console.error('❌ Помилка перевірки цілісності:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка перевірки цілісності'
        });
    }
});

// Виправлення проблем зі сховищем
app.post('/api/storage/repair', async (req, res) => {
    try {
        const db = await readDatabase();
        const repairs = [];
        
        // Видаляємо записи про файли, яких немає на диску
        const validFiles = [];
        for (const file of db.files) {
            const exists = await fileExists(file.fileName);
            if (exists) {
                validFiles.push(file);
            } else {
                repairs.push({
                    action: 'removed_metadata',
                    fileId: file.id,
                    fileName: file.name
                });
            }
        }
        
        db.files = validFiles;
        
        // Видаляємо файли на диску без запису в БД
        const diskFiles = await fs.readdir(FILES_DIR);
        const dbFileNames = new Set(db.files.map(f => f.fileName));
        
        for (const diskFile of diskFiles) {
            if (!dbFileNames.has(diskFile)) {
                await deleteFileFromDisk(diskFile);
                repairs.push({
                    action: 'deleted_orphan',
                    fileName: diskFile
                });
            }
        }
        
        await writeDatabase(db);
        
        console.log(`🔧 Виправлення сховища: ${repairs.length} операцій`);
        
        res.json({
            success: true,
            repairs: {
                count: repairs.length,
                operations: repairs
            }
        });
    } catch (error) {
        console.error('❌ Помилка виправлення сховища:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка виправлення сховища'
        });
    }
});

// Бекап бази даних
app.post('/api/backup', async (req, res) => {
    try {
        const db = await readDatabase();
        const backupFileName = `backup_${Date.now()}.json`;
        const backupPath = path.join(DATA_DIR, backupFileName);
        
        await fs.writeFile(backupPath, JSON.stringify(db, null, 2));
        
        console.log(`💾 Створено бекап: ${backupFileName}`);
        
        res.json({
            success: true,
            backup: {
                fileName: backupFileName,
                path: backupPath,
                timestamp: new Date().toISOString(),
                filesCount: db.files.length,
                usersCount: db.users.length
            }
        });
    } catch (error) {
        console.error('❌ Помилка створення бекапу:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка створення бекапу'
        });
    }
});

// Список бекапів
app.get('/api/backups', async (req, res) => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const backups = files
            .filter(f => f.startsWith('backup_') && f.endsWith('.json'))
            .map(f => {
                const timestamp = f.replace('backup_', '').replace('.json', '');
                return {
                    fileName: f,
                    timestamp: new Date(parseInt(timestamp)).toISOString(),
                    path: path.join(DATA_DIR, f)
                };
            })
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        
        res.json({
            success: true,
            backups,
            count: backups.length
        });
    } catch (error) {
        console.error('❌ Помилка отримання списку бекапів:', error);
        res.status(500).json({
            success: false,
            error: 'Помилка отримання списку бекапів'
        });
    }
});

// Обробка помилок 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint не знайдено',
        path: req.path
    });
});

// Глобальний обробник помилок
app.use((error, req, res, next) => {
    console.error('❌ Глобальна помилка:', error);
    res.status(500).json({
        success: false,
        error: 'Внутрішня помилка сервера',
        message: error.message
    });
});

// Запуск сервера
async function startServer() {
    await initializeStorage();
    
    app.listen(PORT, () => {
        console.log(`
╔══════════════════════════════════════════╗
║  🚀 Сервер запущено                      ║
║  📍 http://localhost:${PORT}              ║
║  🔧 API: http://localhost:${PORT}/api     ║
║                                          ║
║  📂 Файли: ${FILES_DIR}        ║
║  🗄️  БД: ${DB_FILE}            ║
║                                          ║
║  Доступні endpoints:                     ║
║  • GET  /api/health                      ║
║  • POST /api/auth/login                  ║
║  • GET  /api/files                       ║
║  • GET  /api/files/:id                   ║
║  • POST /api/files                       ║
║  • POST /api/files/bulk                  ║
║  • DELETE /api/files/:id                 ║
║  • DELETE /api/files (clear all)         ║
║  • POST /api/sync                        ║
║  • GET  /api/stats                       ║
║  • GET  /api/files/search                ║
║  • GET  /api/export                      ║
║  • GET  /api/storage/info                ║
║  • GET  /api/storage/integrity           ║
║  • POST /api/storage/repair              ║
║  • POST /api/backup                      ║
║  • GET  /api/backups                     ║
╚══════════════════════════════════════════╝
        `);
        
        console.log('\n📊 Сервер готовий до роботи!');
        console.log('💡 Для входу використовуйте: admin / password\n');
    });
}

// Обробка сигналів завершення
process.on('SIGINT', async () => {
    console.log('\n\n🛑 Отримано сигнал зупинки...');
    console.log('💾 Збереження даних...');
    
    // Тут можна додати додаткову логіку очищення
    
    console.log('✅ Сервер зупинено');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Необроблена помилка:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необроблене відхилення промісу:', reason);
});

// Запуск
startServer().catch(error => {
    console.error('❌ Критична помилка запуску сервера:', error);
    process.exit(1);
});

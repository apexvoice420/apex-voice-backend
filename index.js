
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
            expiresIn: '24h',
        });

        res.json({ token, user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Register endpoint (optional, for creating initial users)
app.post('/api/register', async (req, res) => {
    const { email, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
            },
        });

        res.json({ user: { id: user.id, email: user.email } });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Could not create user' });
    }
});

// Auto-seed default user
const seedDefaultUser = async () => {
    try {
        const userCount = await prisma.user.count();
        if (userCount === 0) {
            console.log('No users found. Creating default admin user...');
            const hashedPassword = await bcrypt.hash('password123', 10);
            await prisma.user.create({
                data: {
                    email: 'apexvoicesolutions@gmail.com',
                    password: hashedPassword,
                },
            });
            console.log('Default user created: apexvoicesolutions@gmail.com / password123');
        }
    } catch (error) {
        console.error('Error seeding default user:', error);
    }
};

app.listen(PORT, async () => {
    await seedDefaultUser();
    console.log(`Server running on port ${PORT}`);
});

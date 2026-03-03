const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT) || 6379,
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});

async function waitForDB(retries = 10, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      console.log("Database connected");
      return;
    } catch (err) {
      console.log(
        `DB not ready, retrying in ${delay}ms... (${i + 1}/${retries})`,
      );
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error("Could not connect to database after retries");
}

async function start() {
  await redisClient.connect();
  console.log("Redis connected");

  await waitForDB();

  app.locals.pool = pool;
  app.locals.redis = redisClient;

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const exportsRouter = require("./routes/exportRoutes");
  app.use("/exports", exportsRouter);

  const PORT = process.env.API_PORT || 8080;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});

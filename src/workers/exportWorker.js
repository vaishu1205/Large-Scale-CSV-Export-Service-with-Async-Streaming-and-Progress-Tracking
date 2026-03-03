const fs = require("fs");
const path = require("path");
const { updateJob, getJob } = require("../services/jobService");

const activeJobs = new Map();

function buildQuery(filters, columns) {
  const allowed = [
    "id",
    "name",
    "email",
    "signup_date",
    "country_code",
    "subscription_tier",
    "lifetime_value",
  ];
  const selectedColumns = columns
    ? columns.filter((c) => allowed.includes(c))
    : allowed;
  const conditions = [];
  const values = [];
  let idx = 1;
  if (filters.country_code) {
    conditions.push(`country_code = $${idx++}`);
    values.push(filters.country_code);
  }
  if (filters.subscription_tier) {
    conditions.push(`subscription_tier = $${idx++}`);
    values.push(filters.subscription_tier);
  }
  if (filters.min_ltv !== undefined) {
    conditions.push(`lifetime_value >= $${idx++}`);
    values.push(filters.min_ltv);
  }
  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return {
    countQuery: `SELECT COUNT(*) FROM users ${where}`,
    dataQuery: `SELECT ${selectedColumns.join(", ")} FROM users ${where}`,
    values,
    selectedColumns,
  };
}

function escapeField(value, quoteChar, delimiter) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (
    str.includes(delimiter) ||
    str.includes(quoteChar) ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return (
      quoteChar +
      str.replace(new RegExp(quoteChar, "g"), quoteChar + quoteChar) +
      quoteChar
    );
  }
  return str;
}

function rowToCsv(row, columns, quoteChar, delimiter) {
  return columns
    .map((col) => escapeField(row[col], quoteChar, delimiter))
    .join(delimiter);
}

async function runExport(pool, redisClient, jobId) {
  const EXPORT_PATH = process.env.EXPORT_STORAGE_PATH || "/app/exports";
  const CHUNK_SIZE = 1000;
  const filePath = path.join(EXPORT_PATH, `export_${jobId}.csv`);
  let client;
  let writeStream;
  let cancelled = false;
  activeJobs.set(jobId, {
    cancel: () => {
      cancelled = true;
    },
  });
  try {
    const job = await getJob(redisClient, jobId);
    if (!job) return;
    const { countQuery, dataQuery, values, selectedColumns } = buildQuery(
      job.filters,
      job.columns,
    );
    const delimiter = job.delimiter || ",";
    const quoteChar = job.quoteChar || '"';
    client = await pool.connect();
    const countResult = await client.query(countQuery, values);
    const totalRows = parseInt(countResult.rows[0].count, 10);
    await updateJob(pool, redisClient, jobId, {
      status: "processing",
      totalRows,
      processedRows: 0,
      filePath,
    });
    writeStream = fs.createWriteStream(filePath, { flags: "w" });
    writeStream.write(selectedColumns.join(delimiter) + "\n");
    await client.query("BEGIN");
    await client.query(`DECLARE export_cursor CURSOR FOR ${dataQuery}`, values);
    let processedRows = 0;
    while (true) {
      const current = await getJob(redisClient, jobId);
      if (!current || current.status === "cancelled") {
        cancelled = true;
        break;
      }
      const result = await client.query(
        `FETCH ${CHUNK_SIZE} FROM export_cursor`,
      );
      if (result.rows.length === 0) break;
      const chunk =
        result.rows
          .map((row) => rowToCsv(row, selectedColumns, quoteChar, delimiter))
          .join("\n") + "\n";
      const canWrite = writeStream.write(chunk);
      if (!canWrite)
        await new Promise((resolve) => writeStream.once("drain", resolve));
      processedRows += result.rows.length;
      await updateJob(pool, redisClient, jobId, { processedRows });
    }
    await client.query("CLOSE export_cursor");
    await client.query("COMMIT");
    if (cancelled) {
      writeStream.end();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    await new Promise((resolve, reject) => {
      writeStream.end((err) => (err ? reject(err) : resolve()));
    });
    await updateJob(pool, redisClient, jobId, {
      status: "completed",
      processedRows,
      completedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (writeStream) writeStream.end();
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await updateJob(pool, redisClient, jobId, {
      status: "failed",
      error: err.message,
      completedAt: new Date().toISOString(),
    });
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }
  } finally {
    if (client) client.release();
    activeJobs.delete(jobId);
  }
}

async function cancelJob(pool, redisClient, jobId) {
  const job = activeJobs.get(jobId);
  if (job) job.cancel();
  await updateJob(pool, redisClient, jobId, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
}

module.exports = { runExport, cancelJob };

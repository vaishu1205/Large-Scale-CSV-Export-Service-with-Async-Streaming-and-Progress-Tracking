const { v4: uuidv4 } = require("uuid");

async function createJob(
  pool,
  redisClient,
  filters,
  columns,
  delimiter,
  quoteChar,
) {
  const jobId = uuidv4();
  const job = {
    exportId: jobId,
    status: "pending",
    filters: filters || {},
    columns: columns || null,
    delimiter: delimiter || ",",
    quoteChar: quoteChar || '"',
    totalRows: 0,
    processedRows: 0,
    filePath: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  await redisClient.set(`job:${jobId}`, JSON.stringify(job));

  await pool.query(
    `INSERT INTO export_jobs (id, status, filters, columns, delimiter, quote_char, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      jobId,
      "pending",
      JSON.stringify(filters || {}),
      columns || null,
      delimiter || ",",
      quoteChar || '"',
      job.createdAt,
    ],
  );

  return job;
}

async function getJob(redisClient, jobId) {
  const data = await redisClient.get(`job:${jobId}`);
  if (!data) return null;
  return JSON.parse(data);
}

async function updateJob(pool, redisClient, jobId, updates) {
  const existing = await getJob(redisClient, jobId);
  if (!existing) return null;

  const updated = { ...existing, ...updates };
  await redisClient.set(`job:${jobId}`, JSON.stringify(updated));

  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.totalRows !== undefined) {
    fields.push(`total_rows = $${idx++}`);
    values.push(updates.totalRows);
  }
  if (updates.processedRows !== undefined) {
    fields.push(`processed_rows = $${idx++}`);
    values.push(updates.processedRows);
  }
  if (updates.filePath !== undefined) {
    fields.push(`file_path = $${idx++}`);
    values.push(updates.filePath);
  }
  if (updates.error !== undefined) {
    fields.push(`error_message = $${idx++}`);
    values.push(updates.error);
  }
  if (updates.completedAt !== undefined) {
    fields.push(`completed_at = $${idx++}`);
    values.push(updates.completedAt);
  }

  if (fields.length > 0) {
    values.push(jobId);
    await pool.query(
      `UPDATE export_jobs SET ${fields.join(", ")} WHERE id = $${idx}`,
      values,
    );
  }

  return updated;
}

async function deleteJob(redisClient, jobId) {
  await redisClient.del(`job:${jobId}`);
}

module.exports = { createJob, getJob, updateJob, deleteJob };

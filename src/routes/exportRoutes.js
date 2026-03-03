const express = require("express");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const {
  createJob,
  getJob,
  updateJob,
  deleteJob,
} = require("../services/jobService");
const { runExport, cancelJob } = require("../workers/exportWorker");

const router = express.Router();

router.post("/csv", async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const redis = req.app.locals.redis;
    const filters = {};
    if (req.query.country_code) filters.country_code = req.query.country_code;
    if (req.query.subscription_tier)
      filters.subscription_tier = req.query.subscription_tier;
    if (req.query.min_ltv) filters.min_ltv = parseFloat(req.query.min_ltv);
    const columns = req.query.columns
      ? req.query.columns.split(",").map((c) => c.trim())
      : null;
    const delimiter = req.query.delimiter || ",";
    const quoteChar = req.query.quoteChar || '"';
    const job = await createJob(
      pool,
      redis,
      filters,
      columns,
      delimiter,
      quoteChar,
    );
    setImmediate(() => runExport(pool, redis, job.exportId));
    return res.status(202).json({ exportId: job.exportId, status: "pending" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/:exportId/status", async (req, res) => {
  try {
    const redis = req.app.locals.redis;
    const job = await getJob(redis, req.params.exportId);
    if (!job) return res.status(404).json({ error: "Export job not found" });
    const processedRows = job.processedRows || 0;
    const totalRows = job.totalRows || 0;
    const percentage =
      totalRows > 0
        ? Math.min(100, Math.round((processedRows / totalRows) * 100))
        : 0;
    return res.status(200).json({
      exportId: job.exportId,
      status: job.status,
      progress: { totalRows, processedRows, percentage },
      error: job.error || null,
      createdAt: job.createdAt,
      completedAt: job.completedAt || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/:exportId/download", async (req, res) => {
  try {
    const redis = req.app.locals.redis;
    const job = await getJob(redis, req.params.exportId);
    if (!job) return res.status(404).json({ error: "Export job not found" });
    if (job.status !== "completed")
      return res.status(425).json({ error: "Export not yet completed" });
    const filePath = job.filePath;
    if (!filePath || !fs.existsSync(filePath))
      return res.status(404).json({ error: "Export file not found" });
    const fileName = `export_${job.exportId}.csv`;
    const acceptEncoding = req.headers["accept-encoding"] || "";
    if (acceptEncoding.includes("gzip")) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Accept-Ranges", "bytes");
      const readStream = fs.createReadStream(filePath);
      const gzip = zlib.createGzip();
      readStream.pipe(gzip).pipe(res);
      return;
    }
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers["range"];
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.status(206);
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", fileSize);
    res.status(200);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete("/:exportId", async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const redis = req.app.locals.redis;
    const { exportId } = req.params;
    const job = await getJob(redis, exportId);
    if (!job) return res.status(404).json({ error: "Export job not found" });
    await cancelJob(pool, redis, exportId);
    const EXPORT_PATH = process.env.EXPORT_STORAGE_PATH || "/app/exports";
    const filePath = path.join(EXPORT_PATH, `export_${exportId}.csv`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await deleteJob(redis, exportId);
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

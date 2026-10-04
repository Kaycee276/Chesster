/**
 * Database client wrapper for PostgreSQL (Neon / direct Postgres) and Prisma ORM.
 * Replaces the proprietary @supabase/supabase-js HTTP client with direct node-postgres
 * connection pooling and Prisma ORM client.
 */

const { Pool } = require("pg");
const prisma = require("./prisma");

let poolInstance = null;

function getPool() {
  if (!poolInstance) {
    const connectionString = process.env.DATABASE_URL;
    poolInstance = new Pool({
      connectionString,
      ssl:
        process.env.NODE_ENV === "production" ||
        (connectionString && !connectionString.includes("localhost"))
          ? { rejectUnauthorized: false }
          : false,
      max: parseInt(process.env.PG_MAX_POOL_SIZE || "20", 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    poolInstance.on("error", (err) => {
      console.error("[PostgreSQL Pool Error]", err.message);
    });
  }
  return poolInstance;
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.selectedColumns = "*";
    this.countOption = null;
    this.headOption = false;
    this.insertPayload = null;
    this.updatePayload = null;
    this.conditions = [];
    this.params = [];
    this.orders = [];
    this.limitVal = null;
    this.offsetVal = null;
  }

  _addParam(val) {
    this.params.push(val);
    return `$${this.params.length}`;
  }

  select(columns = "*", { count = null, head = false } = {}) {
    this.selectedColumns = columns;
    this.countOption = count;
    this.headOption = head;
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.insertPayload = payload;
    return this;
  }

  update(payload) {
    this.operation = "update";
    this.updatePayload = payload;
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  eq(column, value) {
    const p = this._addParam(value);
    this.conditions.push(`"${column}" = ${p}`);
    return this;
  }

  neq(column, value) {
    const p = this._addParam(value);
    this.conditions.push(`"${column}" <> ${p}`);
    return this;
  }

  gt(column, value) {
    const p = this._addParam(value);
    this.conditions.push(`"${column}" > ${p}`);
    return this;
  }

  gte(column, value) {
    const p = this._addParam(value);
    this.conditions.push(`"${column}" >= ${p}`);
    return this;
  }

  lt(column, value) {
    const p = this._addParam(value);
    this.conditions.push(`"${column}" < ${p}`);
    return this;
  }

  lte(column, value) {
    const p = this._addParam(value);
    this.conditions.push(`"${column}" <= ${p}`);
    return this;
  }

  in(column, values) {
    if (!Array.isArray(values) || values.length === 0) {
      this.conditions.push("1 = 0");
      return this;
    }
    const p = this._addParam(values);
    this.conditions.push(`"${column}" = ANY(${p})`);
    return this;
  }

  not(column, operator, value) {
    if (operator === "is" && value === null) {
      this.conditions.push(`"${column}" IS NOT NULL`);
    } else {
      const p = this._addParam(value);
      this.conditions.push(`NOT ("${column}" = ${p})`);
    }
    return this;
  }

  or(filterStr) {
    const parts = filterStr.split(",");
    const orClauses = [];
    for (const part of parts) {
      const tokens = part.trim().split(".");
      if (tokens.length >= 3) {
        const col = tokens[0];
        const op = tokens[1];
        const val = tokens.slice(2).join(".");
        if (op === "eq") {
          const p = this._addParam(val);
          orClauses.push(`"${col}" = ${p}`);
        } else if (op === "neq") {
          const p = this._addParam(val);
          orClauses.push(`"${col}" <> ${p}`);
        }
      }
    }
    if (orClauses.length > 0) {
      this.conditions.push(`(${orClauses.join(" OR ")})`);
    }
    return this;
  }

  order(column, { ascending = true, nullsFirst } = {}) {
    const dir = ascending ? "ASC" : "DESC";
    const nulls = nullsFirst !== undefined ? (nullsFirst ? " NULLS FIRST" : " NULLS LAST") : "";
    this.orders.push(`"${column}" ${dir}${nulls}`);
    return this;
  }

  limit(count) {
    this.limitVal = count;
    return this;
  }

  range(from, to) {
    this.offsetVal = from;
    this.limitVal = to - from + 1;
    return this;
  }

  _buildWhere() {
    if (this.conditions.length === 0) return "";
    return ` WHERE ${this.conditions.join(" AND ")}`;
  }

  _buildOrder() {
    if (this.orders.length === 0) return "";
    return ` ORDER BY ${this.orders.join(", ")}`;
  }

  _buildLimit() {
    let sql = "";
    if (this.limitVal !== null && this.limitVal !== undefined) {
      sql += ` LIMIT ${parseInt(this.limitVal, 10)}`;
    }
    if (this.offsetVal !== null && this.offsetVal !== undefined) {
      sql += ` OFFSET ${parseInt(this.offsetVal, 10)}`;
    }
    return sql;
  }

  async _execute() {
    const pool = getPool();
    try {
      if (this.operation === "select") {
        if (this.headOption && this.countOption === "exact") {
          const countSql = `SELECT COUNT(*)::int AS count FROM "${this.table}"${this._buildWhere()}`;
          const res = await pool.query(countSql, this.params);
          return { data: null, count: res.rows[0]?.count || 0, error: null };
        }

        const cols =
          this.selectedColumns === "*"
            ? "*"
            : this.selectedColumns
                .split(",")
                .map((c) => (c.trim() === "count" ? "COUNT(*)::int as count" : `"${c.trim()}"`))
                .join(", ");

        const sql = `SELECT ${cols} FROM "${this.table}"${this._buildWhere()}${this._buildOrder()}${this._buildLimit()}`;
        const res = await pool.query(sql, this.params);
        return { data: res.rows, count: res.rowCount, error: null };
      }

      if (this.operation === "insert") {
        const rows = Array.isArray(this.insertPayload) ? this.insertPayload : [this.insertPayload];
        if (rows.length === 0) return { data: [], error: null };

        const cols = Object.keys(rows[0]);
        const colsSql = cols.map((c) => `"${c}"`).join(", ");
        const valuesSqlList = [];

        for (const row of rows) {
          const rowPlaceholders = [];
          for (const col of cols) {
            let val = row[col];
            if (val && typeof val === "object" && !(val instanceof Date) && val.__raw) {
              rowPlaceholders.push(val.__raw);
            } else if (val && typeof val === "object" && !(val instanceof Date)) {
              rowPlaceholders.push(this._addParam(JSON.stringify(val)));
            } else {
              rowPlaceholders.push(this._addParam(val));
            }
          }
          valuesSqlList.push(`(${rowPlaceholders.join(", ")})`);
        }

        const sql = `INSERT INTO "${this.table}" (${colsSql}) VALUES ${valuesSqlList.join(", ")} RETURNING *`;
        const res = await pool.query(sql, this.params);
        const data = Array.isArray(this.insertPayload) ? res.rows : res.rows[0] || null;
        return { data, error: null };
      }

      if (this.operation === "update") {
        const cols = Object.keys(this.updatePayload || {});
        if (cols.length === 0) return { data: [], error: null };

        const setClauses = [];
        for (const col of cols) {
          const val = this.updatePayload[col];
          if (val && typeof val === "object" && val.__raw) {
            setClauses.push(`"${col}" = ${val.__raw}`);
          } else if (val && typeof val === "object" && !(val instanceof Date)) {
            const p = this._addParam(JSON.stringify(val));
            setClauses.push(`"${col}" = ${p}::jsonb`);
          } else {
            const p = this._addParam(val);
            setClauses.push(`"${col}" = ${p}`);
          }
        }

        const sql = `UPDATE "${this.table}" SET ${setClauses.join(", ")}${this._buildWhere()} RETURNING *`;
        const res = await pool.query(sql, this.params);
        return { data: res.rows, error: null };
      }

      if (this.operation === "delete") {
        const sql = `DELETE FROM "${this.table}"${this._buildWhere()} RETURNING *`;
        const res = await pool.query(sql, this.params);
        return { data: res.rows, error: null };
      }
    } catch (err) {
      return { data: null, error: err };
    }
  }

  async single() {
    const res = await this._execute();
    if (res.error) return res;
    if (!res.data || (Array.isArray(res.data) && res.data.length === 0)) {
      return {
        data: null,
        error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
      };
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    return { data: row, error: null };
  }

  async maybeSingle() {
    const res = await this._execute();
    if (res.error) return res;
    const row = Array.isArray(res.data) ? res.data[0] || null : res.data;
    return { data: row, error: null };
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }
}

const db = {
  prisma,
  from(tableName) {
    return new QueryBuilder(tableName);
  },
  async rpc(fnName, args = {}) {
    const pool = getPool();
    try {
      const keys = Object.keys(args);
      const params = keys.map((k) => args[k]);
      const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `SELECT * FROM "${fnName}"(${placeholders})`;
      const res = await pool.query(sql, params);
      return { data: res.rows, error: null };
    } catch (err) {
      return { data: null, error: err };
    }
  },
  raw(sql) {
    return { __raw: sql };
  },
  getPool,
};

module.exports = db;

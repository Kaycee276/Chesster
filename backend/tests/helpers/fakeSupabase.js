/**
 * In-memory stand-in for the Supabase client, supporting the query-builder
 * subset used by the services under test: from().select().eq().order()
 * awaited directly, or finished with maybeSingle()/single().
 *
 * Usage inside a test file:
 *   jest.mock("../config/supabase", () => require("./helpers/fakeSupabase")());
 *   const supabase = require("../config/supabase");
 *   supabase.__setTable("games", [...rows]);
 */
function createFakeSupabase() {
	const tables = {};
	const queries = [];

	function from(table) {
		const query = { table, filters: [], order: null };
		queries.push(query);

		const rows = () => {
			let result = (tables[table] || []).filter((row) => query.filters.every(([col, val]) => row[col] === val));
			if (query.order) {
				const [col, ascending] = query.order;
				result = result.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
			}
			return result;
		};

		const builder = {
			select: () => builder,
			eq: (col, val) => {
				query.filters.push([col, val]);
				return builder;
			},
			order: (col, { ascending = true } = {}) => {
				query.order = [col, ascending];
				return builder;
			},
			maybeSingle: () => Promise.resolve({ data: rows()[0] || null, error: null }),
			single: () => {
				const [row] = rows();
				return Promise.resolve(row ? { data: row, error: null } : { data: null, error: { message: "Row not found" } });
			},
			then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
		};
		return builder;
	}

	return {
		from,
		__setTable(name, rows) {
			tables[name] = rows.map((row) => ({ ...row }));
		},
		__reset() {
			for (const key of Object.keys(tables)) delete tables[key];
			queries.length = 0;
		},
		__queries: queries,
	};
}

module.exports = createFakeSupabase;

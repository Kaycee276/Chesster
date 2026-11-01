const request = require("supertest");
const { app } = require("../server");

describe("API documentation route", () => {
	test("serves interactive Swagger UI from the OpenAPI specification", async () => {
		const response = await request(app).get("/api/docs/");

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toMatch(/text\/html/);
		expect(response.text).toContain("swagger-ui");
		expect(response.text).toContain("Chesster Platform REST API");
	});
});

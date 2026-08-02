import dotenv from "dotenv";
dotenv.config();

import { searchWeb } from "./services/search.js";

const results = await searchWeb("Best white sneakers under ₹3000");

console.log(results);
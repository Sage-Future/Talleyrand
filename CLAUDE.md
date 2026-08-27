This is a repository for Talleyrand, a web application known as Cursor for Thinking. It is a JS/React app that represents a graph-like UI. Each node lets the user interact with an LLM. The user can submit requests in a ChatNode, and the response field will display the LLM’s answer. The user can build a DAG from these nodes so that, when they run a query, the LLM receives not only the prompt but also the context from all parent nodes. The user can also attach documents to ChatNodes to provide additional context. When the user selects text in a response field, a popup appears where they can enter a query specifically about the selected text. This app introduces new UI and AI features for research.

We follow a few principles:

- We use `pnpm` for frontend and `pdm` for backend.
- Use `pnpm format:check` to check for errors on frontend.
- Use `pdm lint` and `pdm format` to lint and format the backend.
- We do not care about backward compatibility. There are no users yet, so it is fine if we break compatibility with older formats.
- setTimeout() to fix race conditions is bad.
- We avoid fallbacks. If we want to add some fallbacks that might indicate we are not sure if the code correct. Let's step back and think again - what should we do to write correct clear code? If that's really hard, and we had several failured attempts, we can add debuging messages.
- We don't keep dead unused code. Remove it.
- Do not write code that isn't used. If it's not used, remove it.
- When you want to test the result, do not `pnpm start`. Instead, try to build it with `pnpm build`.
- When changes backend API, regenerate OpenAPI client using `pnpm generate-openapi` in frontend folder. Do not apply prettier on the result schema file, because it's generated automatically.

Python codestyle rules:

- Relative imports are restricted
- We group functionality using DDD principles, every new feature should be grouped as a service and contain all respective models, routes and dto's and logic connected to feature.

Do not create .md files unless asked.

Always use context7 when I need code generation, setup or configuration steps, or library/API documentation. This means you should automatically use the Context7 MCP tools to resolve library id and get library docs without me having to explicitly ask.

I no longer read the code, so please avoid technical details like file and variable names unless I ask for them. Communicate with me in terms of product functionality, with only occasional architectural details when relevant.
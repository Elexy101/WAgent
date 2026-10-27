<div align="center">
  <h1>🎙️ WAgent</h1>
  <p><strong>Get a clear answer, with the <em>why</em>.</strong></p>
  <p>An AI-powered, voice-enabled, multi-agent research and comparative shopping assistant.</p>
  
  <!-- Optional: Add badges here once you have them -->
  <!-- ![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E) -->
  <!-- ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB) -->
  <!-- ![Supabase](https://img.shields.io/badge/Supabase-181818?style=for-the-badge&logo=supabase&logoColor=3ECF8E) -->
</div>

---

## 📖 Overview

**WAgent** was built for the **GenAI** to solve a universal problem: the sheer friction of manual research and comparison. 

We waste hours jumping between different websites, reading endless reviews, and cross-referencing prices just to answer a simple question like, *"Find me a cheap flight from Lagos to Abuja next Friday"* or *"How much is a 1kg of catfish in Port Harcourt?"*

WAgent acts as your personal, autonomous research agent. You simply paste a chaotic message from a friend or record a voice note. The AI then decomposes your request, scours live data sources across the web, evaluates the findings based on your priorities (cheapest, fastest, best rated), and presents a **clear answer, with the evidence and reasoning behind it.**

Unlike standard AI chatbots that rely on outdated training data and often hallucinate, WAgent is built on an **Evidence-First Reasoning Architecture**. It doesn't just guess; it proves.

---
## 🧠 The Reasoning Architecture (Our "Secret Sauce")

For this GenAI hackathon, WAgent is not just a simple LLM wrapper. It is a complex, autonomous reasoning engine. Here is how the pipeline works under the hood:

1. **Intake & Task Decomposition (The Planner Agent):** When you ask, *"Find me the cheapest flight from Lagos to Guangzhou with their price tag,"* the planner agent breaks this down into actionable steps. It identifies the intent (flight search), the constraints (Lagos to Guangzhou, cheapest), and the required output (price tags).
2. **Dynamic Tool Calling (The Executor Agent + Nightshift API):** Based on the decomposed task, the system routes the query to specific tools. **Crucially, we integrated the Meterless Nightshift API here.** Because our agents need to scrape multiple fragmented websites simultaneously to compare live prices, standard API rate limits were a bottleneck. The Meterless Nightshift API allows our Executor Agent to perform high-volume, unmetered, asynchronous data retrieval without throttling.
3. **Constraint Evaluation & Synthesis (The Evaluator Agent):** This is where the reasoning happens. The agent scores the retrieved data against the user's prioritized constraints (e.g., `Cheapest total`, `Best rated`, `Fastest`). 
4. **Explainable Output (Chain of Thought):** The final output isn't just a link. It is a synthesized report that explains *why* an option is the best choice, citing the live sources it found.

<img width="1199" height="4319" alt="deepseek_mermaid_20261027_496a0d" src="https://github.com/user-attachments/assets/034ffe17-b06d-4f3f-bbb7-6f9f447dc17d" />


---

## ✨ Core Features

*   🗣️ **Multimodal Input:** Paste a text message or seamlessly upload a voice note. The system handles Speech-to-Text transcription before feeding the prompt into the reasoning engine.
*   🛡️ **Human-in-the-Loop (HITL):** The AI explicitly states, *"You review the sources and confirm before any booking or order link opens."* This ensures the user has the final say, preventing hallucinated bookings.
*   📊 **Prioritization Engine:** Tailor the AI's reasoning to your specific needs with a single click: `Cheapest total`, `Best rated`, `Fastest`, or `Best balance`.
*   📍 **Hyper-Localized Intelligence:** Optimized for fragmented markets. The architecture is designed to handle complex, localized queries (e.g., comparing specific grocery prices in Market Square Port Harcourt vs. Lagos).
*   ⏳ **Asynchronous Investigation Dashboard:** Long-running AI tasks are handled gracefully. Queries are marked as `pending` while the agent scrapes the web, and update to `confirmed` when the evidence is synthesized.

---

## PREVIEW
<img width="1130" height="757" alt="Screenshot from 2026-10-27 05-18-13" src="https://github.com/user-attachments/assets/713de51b-ff37-4d42-853d-8033bbc054e3" />
<img width="1130" height="757" alt="Screenshot from 2026-10-27 05-18-27" src="https://github.com/user-attachments/assets/ac1ded31-17d7-4b83-8297-709a71cc1bb9" />
<img width="1130" height="757" alt="Screenshot from 2026-10-27 05-18-32" src="https://github.com/user-attachments/assets/dad0894a-7917-40ad-b42a-5ac4d74ee3d0" />


## 🏗️ Technology Stack

We chose a modern, highly performant, and scalable stack to ensure fast inference and a seamless user experience.

*   **Frontend UI:** React + Vite + TypeScript
*   **Styling:** Tailwind CSS + Shadcn UI (indicated by `components.json`)
*   **Backend / Database:** Supabase (Auth, Postgres Database)
*   **ORM:** Drizzle ORM (`drizzle.config.ts`) for type-safe database queries
*   **Runtime:** Bun (`bun.lock`, `bunfig.toml`) for ultra-fast package management and script execution
*   **Local Environment:** Docker Compose (`docker-compose.yml`) for spinning up local services

---

## 🚀 Getting Started (Local Development)

Follow these steps to get WAgent running on your local machine.

### Prerequisites
Make sure you have the following installed:
*   [Bun](https://bun.sh/) (v1.0 or higher)
*   [Docker](https://www.docker.com/) (Optional, for local database containerization)
*   [Supabase CLI](https://supabase.com/docs/guides/cli) (Optional, if you want to run the backend locally)

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/voicereply.git
cd voicereply

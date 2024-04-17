import random

CHUNK_MERGE_DISTANCE = 20

class Agent:
    async def answer(self, aliases):
        if len(aliases) == 1:
            path = self.paths()[aliases[0]]
            doc = await self.get_file_content(path)
            if doc is None:
                raise Exception("Path did not exist")
            self.update(Update.Focus(FocusedChunk(
                file_path=path,
                start_line=0,
                end_line=len(doc.content.lines())
            )))

        context = await self.answer_context(aliases)
        system_prompt = self.model.system_prompt(context)
        system_message = llm_gateway.api.Message.system(system_prompt)
        history = self.utter_history()
        system_headroom = tiktoken_rs.num_tokens_from_messages(
            self.model.tokenizer,
            [system_message]
        )
        headroom = self.model.answer_headroom + system_headroom
        history = trim_utter_history(history, headroom, self.model)
        messages = [system_message] + history

        response = ""
        async for fragment in self.llm_gateway.model(self.model.model_name).chat_stream(messages):
            response += fragment

            article, summary = transcoder.decode(response)
            self.update(Update.Article(article))

            if summary is not None:
                self.update(Update.Conclude(summary))

        article, summary = transcoder.decode(response)
        summary = summary or random.choice([
            "I hope that was useful, can I help with anything else?",
            "Is there anything else I can help you with?",
            "Can I help you with anything else?"
        ])

        self.update(Update.Conclude(summary))

        self.track_query(
            EventData.output_stage("answer_article")
            .with_payload("query", self.last_exchange().query())
            .with_payload("query_history", history)
            .with_payload("response", response)
            .with_payload("raw_prompt", system_prompt)
            .with_payload("model", self.model.model_name)
        )

async def answer_context(self, aliases):
    paths = self.paths()
    s = ""

    aliases = [alias for alias in aliases if alias < len(paths)]
    aliases.sort()

    if aliases:
        s += "##### PATHS #####\n"
        for alias in aliases:
            path = paths[alias]
            s += f"{path}\n"

    code_chunks = self.canonicalize_code_chunks(aliases)

    remaining_prompt_tokens = tiktoken_rs.get_completion_max_tokens(self.model.tokenizer, s)

    recent_chunks = []
    for chunk in reversed(code_chunks):
        snippet = "\n".join(f"{i + chunk.start_line + 1} {line}" for i, line in enumerate(chunk.snippet.lines()))
        snippet_tokens = len(self.model.tokenizer.encode_ordinary(snippet))

        if snippet_tokens >= remaining_prompt_tokens - self.model.prompt_headroom:
            break

        recent_chunks.append((chunk, snippet))
        remaining_prompt_tokens -= snippet_tokens

    recent_chunks_by_alias = {}
    for chunk, formatted_snippet in recent_chunks:
        recent_chunks_by_alias.setdefault(chunk.alias, []).append((chunk, formatted_snippet))

    if recent_chunks_by_alias:
        s += "\n##### CODE CHUNKS #####\n\n"

    aliases = sorted(recent_chunks_by_alias.keys())
    for alias in aliases:
        chunks = recent_chunks_by_alias[alias]
        chunks.sort(key=lambda c: c[0].start_line)
        for _, formatted_snippet in chunks:
            s += formatted_snippet

    return s

def trim_utter_history(history, headroom, model):
    tiktoken_msgs = [m.into() for m in history]

    while tiktoken_rs.get_chat_completion_max_tokens(model.tokenizer, tiktoken_msgs) < headroom:
        if tiktoken_msgs:
            tiktoken_msgs.pop(0)
            history.pop(0)
        else:
            raise Exception("Could not find message to trim")

    return history

def merge_overlapping(a, b):
    if a.end + CHUNK_MERGE_DISTANCE >= b.start:
        if a.end < b.end:
            a.end = b.end
        return None
    else:
        return b

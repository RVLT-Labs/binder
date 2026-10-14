CREATE TABLE "sync_applied_chunks" (
	"batch_key" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_applied_chunks_batch_key_chunk_index_pk" PRIMARY KEY("batch_key","chunk_index")
);

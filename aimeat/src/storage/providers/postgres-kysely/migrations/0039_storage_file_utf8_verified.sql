-- TARGET-063: record, once per write, whether a stored file's bytes decode as UTF-8.
--
-- WHY A COLUMN AND NOT A READ. The served Content-Type of an uploaded text file depends on a strict
-- UTF-8 decode of the WHOLE file, and until now every response ran that decode: it needed the bytes,
-- so it read them. Serving a byte range is where that design breaks, because not reading the file is
-- the entire point of a range. Measured on this backend: an 8-byte suffix range out of a 25 MB file
-- costs 181 ms as a whole-row read and 3 ms as a database-side substring. The decode belongs on the
-- write, where the bytes are already in hand and the answer is a property of the file.
--
-- NO BACKFILL, DELIBERATELY. There is no UTF-8 validity predicate in SQL that does not raise on the
-- first bad byte and take the whole UPDATE with it (convert_from raises; pg_input_is_valid does not
-- cover bytea to text). So existing rows keep NULL, and a range read of one loads the file exactly
-- as it does today — the same header, the same cost, no guess. Each row settles itself the next time
-- it is written. Nothing published after this migration is affected, which is the case that matters.
--
-- NULL means "not established", never "not UTF-8". utils/app-content-type.ts treats the two the same
-- way on purpose: both say nothing about the charset and serve the file as it is served today.

ALTER TABLE "StorageFile" ADD COLUMN IF NOT EXISTS "utf8Verified" BOOLEAN;

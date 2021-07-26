CREATE TABLE Words (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	server_name TEXT,
	username TEXT,
	word TEXT,
	audio_data INTEGER,
	score NUMERIC
);
// A single file above this size is skipped and reported. Hand-written source
// files are far smaller; files this large are nearly always generated, and
// each one is decoded and tokenized in memory.
export const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

// Total source text held in memory for one analysis. Past it, the analysis
// stops with an error instead of running the process out of memory.
export const MAX_SOURCE_BYTES_IN_MEMORY = 768 * 1024 * 1024;

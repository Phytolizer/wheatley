import { strict as assert } from "assert";

export interface index_entry {
    title: string;
};

const DEBUG = true;

function max<T>(arr: T[], f: (x: T) => any = (x: T) => x) {
    if(arr.length == 0) {
        assert(false);
    } else {
        return arr.slice(1).reduce((previous, current) => f(current) > f(previous) ? current : previous, arr[0]);
    }
}

export function tokenize(str: string) {
    // ~ is included, along with alphanumeric characters (and _?)
    return str.toLowerCase().split(/[^a-z0-9~]+/gi).filter(s => s != "");
}

function intersect<T>(a: Set<T>, b: Set<T>) {
    return new Set([...a].filter(item => b.has(item)));
}

function set_xor<T>(a: Set<T>, b: Set<T>) {
    return new Set([
        ...[...a, ...b].filter(item => !a.has(item) || !b.has(item)),
    ]);
}

// returns a - b
function set_diff<T>(a: Set<T>, b: Set<T>) {
    return new Set([
        ...[...a].filter(item => !b.has(item))
    ]);
}

function raw_ngrams(str: string, n: number) {
    const arr = [];
    for(let i = 0; i <= str.length - n; i++) {
        arr.push(str.slice(i, i + n));
    }
    return arr;
}

function cosine_similarity(a_ngrams: Set<string>, b_ngrams: Set<string>, f: (s: string) => number) {
    let dot = 0;
    let a_mag = 0;
    let b_mag = 0;
    for(const ngram of new Set([...a_ngrams, ...b_ngrams])) {
        // dot computation
        if(a_ngrams.has(ngram) && b_ngrams.has(ngram)) {
            //assert(ngram in ngram_idf);
            dot += f(ngram) * f(ngram);
        }
        // magnitude computations
        if(a_ngrams.has(ngram) /*&& ngram in ngram_idf*/) {
            a_mag += f(ngram) * f(ngram);
        }
        if(b_ngrams.has(ngram) /*&& ngram in ngram_idf*/) {
            b_mag += f(ngram) * f(ngram);
        }
    }
    if(a_mag == 0 || b_mag == 0) {
        return -1;
    }
    return dot / (Math.sqrt(a_mag) * Math.sqrt(b_mag));
}

function cosine_similarity_uniform(a_ngrams: Set<string>, b_ngrams: Set<string>) {
    return cosine_similarity(a_ngrams, b_ngrams, s => {
        return 1;
    });
}

function cosine_similarity_idf(a_ngrams: Set<string>, b_ngrams: Set<string>, ngram_idf: Record<string, number>) {
    return cosine_similarity(a_ngrams, b_ngrams, s => {
        //assert(s in ngram_idf);
        return ngram_idf[s];
    });
}

// exported for test purposes
export function strip_parentheses(title: string, opening: string, closing: string) {
    let parentheses_start: number[] = [];
    for(let i = 0; i < title.length; i++) {
        if(title[i] == opening) {
            parentheses_start.push(i);
        } else if(title[i] == closing) {
            if(parentheses_start.length > 0) {
                const start = parentheses_start.pop()!;
                const parentheses_part = title.substring(start, i + 1);
                if(start > 0 && title[start - 1] == " ") {
                    if(!parentheses_part.match(/\bc(\+\+)?\s*\d+\b/i) && !parentheses_part.includes("::")) {
                        // pass
                        //if(DEBUG) console.log("PASS: ", parentheses_part);
                    } else {
                        //if(DEBUG) console.log("CCCC: ", parentheses_part);
                        title = title.slice(0, start) + title.slice(i + 1);
                        i = start - 1; // i will be incremented next
                    }
                } else if(title.substring(0, start).match(/\boperator(?!.+::)\b/)) {
                    // for operator declarations, pass
                    // cases like
                    // operator==, !=, <, <=, >, >=, <=>(std::optional)
                    // std::expected<t,e>::operator->, std::expected<t,e>::operator*
                } else {
                    //if(DEBUG) console.log(parentheses_part);
                    title = title.slice(0, start) + title.slice(i + 1);
                    i = start - 1; // i will be incremented next
                }
            }
        }
    }
    return title.trim();
}

function sanitize_title(title: string) {
    title = strip_parentheses(title, "(", ")");
    title = strip_parentheses(title, "<", ">");
    return title;
}

export function smart_split_title(title: string) {
    let splits = [];
    let parentheses_start: number[] = [];
    let split_start = 0;
    for(let i = 0; i < title.length; i++) {
        if(title[i] == "(") {
            parentheses_start.push(i);
        } else if(title[i] == ")") {
            parentheses_start.pop();
            //if(parentheses_start.length > 0) {
                //const start = parentheses_start.pop()!;
                //title = title.slice(0, start) + title.slice(i + 1);
                //i = start - 1; // i will be incremented next
            //}
        } else if(title[i] == ",") {
            if(parentheses_start.length == 0) {
                splits.push(title.substring(split_start, i));
                split_start = i + 1;
            } else {
                // ignore
            }
        }
    }
    if(split_start < title.length) {
        splits.push(title.substring(split_start));
    }
    return splits.map(s => s.trim());
}

function split_title(title: string) {
    return title.split(",").map(s => s.trim());
}

export function parse_title(title: string) {
    title = title.toLowerCase();
    if(title.match(/\boperator\b/)) {
        // take a case like
        // operator==, !=, <, <=, >, >=, <=>(std::optional)
        // try to split it into operator==(std::optional), operator!=(std::optional), ... etc.
        // the one pitfall here is taking something like std::atomic<T>::operator++,++(int),--,--(int) and making all entries
        // operator++(int) but that's perfectly fine for search purposes
        const parts = split_title(sanitize_title(title));
        const operator_parts = new Set(parts.map(p => p.match(/^.*\boperator\b/)).filter(o => o != null).map(m => m![0]));
        const args_parts = new Set(parts.map(p => p.match(/(?<!operator)\s*\(.*\)$/)).filter(o => o != null).map(m => m![0]));
        ///assert(operator_parts.size <= 1 && args_parts.size <= 1);
        // sorting by size because of cases like
        // std::experimental::filesystem::directory_iterator::operator*,operator->
        // operator_parts will be "std::experimental::filesystem::directory_iterator::operator" and "operator", take the first
        const operator_part = operator_parts.size ? [...operator_parts].sort((a, b) => b.length - a.length)[0] : null;
        const args_part = args_parts.size ? [...args_parts].sort((a, b) => b.length - a.length)[0] : null;
        ///if(new Set(operator_parts).size > 1 || new Set(args_parts).size > 1) {
        ///    console.log(title, parts);
        ///    console.log(operator_parts);
        ///    console.log(args_parts);
        ///}
        const corrected_parts = parts.map(part => {
            if(operator_part && !part.startsWith(operator_part)) {
                // handle cases like std::coroutine_handle<promise>::operator(), std::coroutine_handle<promise>::resume
                if(!part.startsWith("std::")) {
                    part = operator_part + part;
                }
            }
            if(args_part && !part.endsWith(args_part)) {
                part = part + args_part;
            }
            return part;
        });
        ///console.log(title, corrected_parts);
        ///if(operator_part || args_part) {
        ///    console.log(title, corrected_parts);
        ///}
        return corrected_parts;
        ///const match = title.match(/\boperator\b/);
        ///const operator_part =
        ///return split_title(sanitize_title(title));
    } else {
        return split_title(sanitize_title(title));
    }
}

// ---------------------------------------------------------------------------------------------------------------------

type BaseEntryData = { parsed_title: string[] };
type EntryScore = {
    score: number;
    debug_info: any[];
};

abstract class BaseIndex<T extends index_entry, ExtraEntryData = {}> {
    // hack because ts doesn't allow type aliases here
    protected entries: (T & BaseEntryData & ExtraEntryData)[];
    constructor(entries: T[]) {
        this.entries = this.process_entries(entries);
    }
    process_entries(entries: T[]): (T & BaseEntryData & ExtraEntryData)[] {
        return entries.map(entry => {
            const parsed_title = parse_title(entry.title);
            return {
                ...entry,
                parsed_title
            } as T & BaseEntryData & ExtraEntryData;
        });
    }
    abstract score(query: string, title: string): EntryScore;
    score_entry(query: string, entry: T & BaseEntryData & ExtraEntryData) {
        const scores: EntryScore[] = [];
        for(const title of entry.parsed_title) {
            scores.push(this.score(query, title));
        }
        return max(scores, s => s.score);
    }
    search(query: string) {
        type candidate_entry = {
            page: T;
            score: number;
            debug_info: any
        };
        //const query_tokens = tokenize(query);
        //assert(query_tokens.length <= 32);
        assert(query.length < 100);
        const candidates: candidate_entry[] = [];
        for(const page of this.entries) {
            const {score, debug_info} = this.score_entry(query, page);
            candidates.push({
                page,
                score,
                debug_info
            });
        }
        candidates.sort((a, b) => b.score - a.score);
        if(DEBUG) console.log(query);
        if(DEBUG) candidates.slice(0, 10).map(candidate => console.log(candidate.score, candidate.page.title, candidate.debug_info));
        return candidates[0].page;
    }
}

/*
class BasicIndex<T extends index_entry> extends BaseIndex<T> {
    constructor(entries: T[]) {
        super(entries);
    }
    override score(query: string, entry: T) {
        // ...
        return {
            score: 0,
            debug_info: [undefined]
        };
    }
}
*/

// Strategy 0: Baseline ------------------------------------------------------------------------------------------------

class BasicIndex<T extends index_entry> extends BaseIndex<T> {
    constructor(entries: T[]) {
        super(entries);
    }
    override score(query: string, title: string): EntryScore {
        const query_tokens = tokenize(query);
        const title_tokens = tokenize(title);
        const same_tokens = intersect(
            new Set(query_tokens),
            new Set(title_tokens)
        );
        return {
            score: same_tokens.size,
            debug_info: [...same_tokens]
        };
    }
}

// ---------------------------------------------------------------------------------------------------------------------

export class Index<T extends index_entry> extends BasicIndex<T> { }

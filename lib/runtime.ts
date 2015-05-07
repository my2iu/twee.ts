// Declare the external Markdown processor

declare var marked : any;


class Passage {
    constructor(public name : string, public codename: string, public tags: string[]) {
    }
	run(_$_: PassageOutput) : void { }
	hasTag(name: string) : boolean { 
		for (let n = 0; n < this.tags.length; n++)
			if (this.tags[n] == name) 
				return true;
		return false;
	}
	hasTagNameValue(name: string) : boolean {
		for (let n = 0; n < this.tags.length; n++)
		{
			var equal = this.tags[n].indexOf('=');
			if (equal >= 0)
			{
				var key = this.tags[n].substring(0, equal);
				var value = this.tags[n].substring(equal + 1);
				if (key.trim() == name) return true;
			}
		}
		return false;
	}
	getTagValue(name: string) : string {
		for (let n = 0; n < this.tags.length; n++)
		{
			var equal = this.tags[n].indexOf('=');
			if (equal >= 0)
			{
				var key = this.tags[n].substring(0, equal);
				var value = this.tags[n].substring(equal + 1);
				if (key.trim() == name) return value.trim();
			}
		}
		return null;
	}
}

var passages : Passage[] = [];

function htmlEscape(str : any) : string {
	return $("<div>").text('' + str).html();
}

const TWINETS_PASSAGE_SCHEMA = 'twine.ts+passage:';
const TWINETS_FUNCTION_SCHEMA = 'twine.ts+function:';

class PassageOutput {
	output : string = '';
	out(str: any) {
		this.output += '' + str;
	}
	mergeIn(merge: PassageOutput) {
		this.output += merge.output;
	}
}

class Story {
	startPassageName: string = 'Start';
	passageMap: { [key:string]:Passage } = {};
	visitedPassages: { [key:string]:boolean } = {};
	currentPassage: Passage = null;
	previousPassage : Passage = null;

	/**
	 * When we started this "turn" with the user clicking on something, what was
	 * the currentPassage? (Later on, we might have fallen through to another passage,
	 * which changed the currentPassage to something else.)
	 */
	firstCurrentPassage: Passage = null;
	previousFirstCurrentPassage: Passage = null;
	
	/**
	 * As passages include and fallthrough to other passages, their output 
	 * objects are stored in a stack. This allows a passage to call an
	 * outside function, and that function can then add to the output of the
	 * current passage without needing an explicit copy of the output object.
	 */
	passageOutputStack : PassageOutput[] = [];
	
	init() {
		// Make a proper map of all the passages
		passages.forEach((passage) => {
			this.passageMap[passage.name] = passage;
		});
	}
	
	parseMarkdown(text : string, passageBase : string) :string {
		var lexer = new marked.Lexer();
		
		// Do an initial pass over the code to find Twine Harlowe-style links and
		// rewrite them into a special html link.
		text = text.replace(/\[\[(.*?)\]\]/g, function(match, link) {
			var dest = link;
			var anchorText = link;
			let arrowPos = link.indexOf('->');
			if (arrowPos >= 0)
			{
				dest = link.substring(arrowPos + 2);
				anchorText = link.substring(0, arrowPos);
			}
			dest = dest.trim();
			return '<a href="' + TWINETS_PASSAGE_SCHEMA + dest + '" twinetsbase="' + passageBase + '">' + anchorText + '</a>';
		});
		
		// Disable the handling of 4 spaces at the front of a line meaning
		// a code block because you might have inlined some stuff that inserts
		// some spaces there, triggering a code block unintentionally
		lexer.rules.code = {exec: function() {return null; }};
		return marked.parser(lexer.lex(text));
	}
	
	findPassage(name: string) : Passage {
		return this.passageMap[name];
	}
	
	canonicalizePassageName(base: string, name: string) : string {
		return name;
	}
	
	currentPassageOutput() : PassageOutput {
		return this.passageOutputStack[this.passageOutputStack.length - 1];
	}
	
	runPassage(passage: Passage) : PassageOutput 
	{
		this.visitedPassages[passage.name] = true;
		
		let output = new PassageOutput();
		this.passageOutputStack.push(output);
		try {
			passage.run(output);
		} finally {
			this.passageOutputStack.pop();
		}
		return output;
	}
	
	show(passage : Passage) : void {
		this.previousFirstCurrentPassage = this.firstCurrentPassage;
		this.previousPassage = this.currentPassage;
		this.firstCurrentPassage = passage;
		this.currentPassage = passage;
	
		// Run the passage code to get the Markdown to show
		let output = this.runPassage(passage);
		var text = output.output;
		
		// Render the Markdown and put it onto the web page
		$("#passage").html(this.parseMarkdown(text, ''));
		
		// Rewrite any links to hide where they go to and to properly trigger a new passage
		$("#passage a[href]").each((idx, el) => {
			var href = el.getAttribute('href');
			if (href && href.indexOf(TWINETS_PASSAGE_SCHEMA) == 0) {
				let passageDest = href.substring(TWINETS_PASSAGE_SCHEMA.length);
				let passageBase = el.getAttribute('twinetsbase');
				if (passageBase == null) passageBase = '';
				let fullPassageName = this.canonicalizePassageName(passageBase, passageDest);
				let passage = story.findPassage(fullPassageName);
				el.setAttribute('href', 'javascript:void(0)');
				(<HTMLAnchorElement>el).onclick = (evt) => {
					story.show(passage);
				};
				
			}
		});
	}
}

var story : Story = new Story();

function startGame() : void
{
	story.init();
	story.show(story.findPassage(story.startPassageName));
}

// Make sure all other initialization code has run first 
// before starting up the engine
setTimeout(() => { startGame(); }, 0);

// Various library helper functions that can be called from game code

function passage() : Passage
{
	return story.currentPassage;
}

function previous() : Passage
{
	return story.previousPassage;
}

function visited(passage: Passage) : boolean
{
	return story.visitedPassages[passage.name];
}

function include(passage: Passage) : void
{
	// Get the current output context
	var output = story.runPassage(passage);
	story.currentPassageOutput().mergeIn(output);
}

function fallthrough(passage: Passage) : void
{
	story.currentPassage = passage;
	include(passage);
}
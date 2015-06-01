// Declare the external Markdown processor

declare var marked : any;
interface ITweeTsHelpers {
	canonicalizePassageName : (base: string, name: string) => string;
	getBadLinksReport : ( logger: (text: string) => void ) => boolean;
}
declare var tweeTsHelpers: ITweeTsHelpers;

class Passage {
    constructor(public name : string, public tags: string[]) {
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

interface PassageModule {
	_passages : Passage[];
	_submodules : PassageModule[];
}

function htmlEscape(str : any) : string {
	return $("<div>").text('' + str).html();
}

const TWINETS_PASSAGE_SCHEMA = 'twine.ts+passage:';
const TWINETS_FUNCTION_SCHEMA = 'twine.ts+function:';

class PassageOutput {
	output : string = '';
	tags : string[] = [];
	renderedHtml : string = null;
	out(str: any) {
		this.output += '' + str;
	}
	mergeIn(merge: PassageOutput) {
		this.output += merge.output;
	}
	appendTagsFrom(tags: string[]) : void {
		for (var n = 0; n < tags.length; n++)
			this.tags.push(tags[n]);
	}
	copyTagsFrom(tags: string[]) : void {
		this.tags = [];
		this.appendTagsFrom(tags);
	}
	hasTag(tag: string) : boolean {
		for (let n = 0; n < this.tags.length; n++)
			if (this.tags[n] == tag) 
				return true;
		return false;
	}
}

class Story {
	startPassageName: string = 'Start';
	passageMap: { [key:string]:Passage } = {};
	visitedPassages: { [key:string]:boolean } = {};
	currentPassage: Passage = null;
	previousPassage : Passage = null;
	hideLinks = true;
	ignoreBadLinks = false;
	allowUndo = true;
	loadListeners : Array<()=> void> = [];
	
	displayOutputHandlers : Array<(markdown: PassageOutput) => boolean> = [];

	// Members related to saving and checkpointing
	createSaveHandler: () => any = null;
	restoreSaveHandler: (any) => void = null;
	lastValidCheckpoint: string = null;

	// Keeps track of functions that can be linked back into the text later
	functionLinkCount = 0;
	functionLinkMap : { [key:number]:()=>void } = {};
	runAfterFunctions : Array<()=>void> = [];
	
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
		this.indexPassage(book);
		
		// Add some default handlers for processing output
		this.displayOutputHandlers.push(
			// Default handler for putting all the output in the passage html
			(output : PassageOutput) : boolean => {
				$("#passage").html(output.renderedHtml);
				return true;
			});
		this.displayOutputHandlers.push(
			// Handler for popup passages
			(output : PassageOutput) : boolean => {
				if (!output.hasTag('popup'))
					return false;
				this.popup(output.renderedHtml);
				output.copyTagsFrom(['nocheckpoint']);
				return true;
			});
		this.displayOutputHandlers.push(
			// Handler that ignores passages marked as silent
			(output : PassageOutput) : boolean => {
				if (!output.hasTag('silent'))
					return false;
				output.copyTagsFrom(['nocheckpoint']);
				return true;
			});
	}
	
	/**
	 * Go through all the passages and put them in a dictionary indexed
	 * by passage name so that it's easier to find them.
	 */
	indexPassage(passageModule : PassageModule) {
		for (let n = 0; n < passageModule._passages.length; n++) {
			let passage = passageModule._passages[n];
			this.passageMap[passage.name] = passage;
		}
		for (let n = 0; n < passageModule._submodules.length; n++) {
			this.indexPassage(passageModule._submodules[n]);
		}
	}
	
	addLoadListener(fn: ()=> void) {
		this.loadListeners.push(fn);
	}
	
	registerSaveHandlers(save: () => any, restore: (any) => void) {
		this.createSaveHandler = save;
		this.restoreSaveHandler = restore;
	}

	/**
	 * Starts the game out by showing the first passage.
	 */
	showFirstPassage() : void {
		// Start showing the first passage
		let startPassageName = this.canonicalizePassageName('/', story.startPassageName);
		let startPassage = this.findPassage(startPassageName);
		if (startPassage == null) throw Error('Cannot find start passage ' + startPassageName);
		this.show(startPassage);
	}
	
	/**
	 * Create a JSON object with the current story state.
	 * I can think of two ways of saving the state. 
	 * 1. We can save the screen output and all the variables. This can cause
	 *    problems if we can't fully save the screen output with its links and 
	 *    embedded code
	 * 2. Save the current passage name, and the variables before the passage was
	 *    shown. This can cause problems if there are things shown on the screen 
	 *    that aren't recreated just be reshowing the passage or if the passage does
	 *    different things each time it's run due to randomness.
	 * Here, I'm using approach #2.
	 */
	createCheckpoint(passageName: string): string {
		if (!this.createSaveHandler) return null;
		var checkpoint = {
			passage: passageName,
			state: this.createSaveHandler(),
			visited: this.visitedPassages,
		};
		return JSON.stringify(checkpoint);
	}
	
	restoreCheckpoint(checkpoint: string) {
		if (!this.restoreSaveHandler) return;
		if (checkpoint == null) return;
		var json = JSON.parse(checkpoint);
		if (json == null) return;
		if (!json.passage) return;
		
		// Assume we have a valid checkpoint
		this.visitedPassages = json.visited;
		this.restoreSaveHandler(json.state);
		
		// Prevents us from resaving the just restored state as a checkpoint
		this.lastValidCheckpoint = null;
		
		// Replay the passage that was shown in that checkpoint
		this.show(this.findPassage(json.passage));
	}
	
	prefilterMarkdown(text : string, passageBase : string) : string {
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
		return text;
	}
	
	parseMarkdown(text : string) :string {
		var lexer = new marked.Lexer();
		
		// Disable the handling of 4 spaces at the front of a line meaning
		// a code block because you might have inlined some stuff that inserts
		// some spaces there, triggering a code block unintentionally
		lexer.rules.code = {exec: function() {return null; }};
		return marked.parser(lexer.lex(text));
	}
	
	findPassage(name: string) : Passage {
		return this.passageMap[name];
	}
	
	/**
	 * Returns a full passage name based on the current passage and a relative
	 * path name
	 */
	canonicalizePassageName(base: string, name: string) : string {
		return tweeTsHelpers.canonicalizePassageName(base, name);
	}
	
	currentPassageOutput() : PassageOutput {
		return this.passageOutputStack[this.passageOutputStack.length - 1];
	}
	
	runPassage(passage: Passage) : PassageOutput 
	{
		this.visitedPassages[passage.name] = true;
		
		let output = new PassageOutput();
		output.copyTagsFrom(passage.tags);
		this.passageOutputStack.push(output);
		try {
			passage.run(output);
		} finally {
			this.passageOutputStack.pop();
		}
		output.output = this.prefilterMarkdown(output.output, passage.name);
		return output;
	}

	/**
	 * Displays some HTML in a "popup" window over the passage text
	 */
	popup(html: string) : void {
		let popup = $('<div class="popup"></div>');
		popup.html(html);
		let popupClose = $('<div class="popupClose"><a href="javascript:void(0)">X</a></div>');
		popup.append(popupClose);
		$('a', popupClose).click( (evt) => popup.remove() );
		$("#passage").append(popup);
	}

	// TODO: Find a better name than "show"
	show(passage : Passage) : void {
		if (passage == null) return;
		this.previousFirstCurrentPassage = this.firstCurrentPassage;
		this.previousPassage = this.currentPassage;
		this.firstCurrentPassage = passage;
		this.currentPassage = passage;
		
		// Saving is difficult because some actions can't be recreated by Twee.ts.
		// At the start of every action, Twee.ts will create a checkpoint, but it
		// won't know if the checkpoint is for a passage that can be replayed until
		// after the passage is run. If the checkpoint is found to be valid, it will 
		// be saved as a valid checkpoint.
		let attemptedCheckpoint = this.createCheckpoint(passage.name);
	
		// Run the passage code to get the Markdown to show
		let output = this.runPassage(passage);
		
		// Render the Markdown to html
		output.renderedHtml = this.parseMarkdown(output.output);
		
		// Put the html up in the passage section (or wherever it should be displayed)
		for (let n = this.displayOutputHandlers.length - 1; n >= 0; n--) {
			// Find the right display handler for displaying a passage with 
			// its combination of tags
			if (this.displayOutputHandlers[n](output)) 
				break;
		}
		
		// Rewrite any links to hide where they go to and to properly trigger a new passage
		$("#passage a[href]").each((idx, el) => {
			var href = el.getAttribute('href');
			if (href && href.indexOf(TWINETS_PASSAGE_SCHEMA) == 0) {
				let passageDest = href.substring(TWINETS_PASSAGE_SCHEMA.length);
				let passageBase = el.getAttribute('twinetsbase');
				if (passageBase == null) passageBase = '';
				let fullPassageName = this.canonicalizePassageName(passageBase, passageDest);
				let passage = story.findPassage(fullPassageName);
				if (this.hideLinks)
					el.setAttribute('href', 'javascript:void(0)');
				(<HTMLAnchorElement>el).onclick = (evt) => {
					story.show(passage);
					evt.preventDefault();
				};
			} else if (href && href.indexOf(TWINETS_FUNCTION_SCHEMA) == 0) {
				let functionNumber = parseInt(href.substring(TWINETS_FUNCTION_SCHEMA.length));
				let fun = this.functionLinkMap[functionNumber];
				if (this.hideLinks)
					el.setAttribute('href', 'javascript:void(0)');
				(<HTMLAnchorElement>el).onclick = (evt) => {
					fun();
					evt.preventDefault();
				};
			}
		});
		
		// Run all the code that should be run after everything is rendered
		for (let n = 0; n < this.runAfterFunctions.length; n++) {
			this.runAfterFunctions[n]();
		}
		this.runAfterFunctions.length = 0;
		
		// Clear the map of functions since all of them should be linked into the 
		// html by now, so we don't need to keep the mapping of IDs to functions
		this.functionLinkMap = {};
		
		// See if the checkpoint we created is for a valid point that we can
		// replay from. If so, then store the checkpoint as a possible save state
		if (attemptedCheckpoint != null && !output.hasTag('nocheckpoint'))
		{
			if (this.lastValidCheckpoint != null && this.allowUndo) 
			{
				// We've clicked a link and navigated to a new passage.
				// Store the checkpoint (not really necessary since we've probably
				// called replaceState() or pushState() already with the same checkpoint).
				history.replaceState(this.lastValidCheckpoint, '');
				// Advance to a new entry
				history.pushState(attemptedCheckpoint, '');
			}
			else
			{
				// We've either just started or have restored from a previous
				// checkpoint, so just update the current state so that if the 
				// browser is closed (or if back is chosen then forward again),
				// we can restart at this point in the game
				history.replaceState(attemptedCheckpoint, '');
			}
			this.lastValidCheckpoint = attemptedCheckpoint;
		}
	}
}

var story : Story = new Story();

window.onpopstate = (evt) => {
	story.restoreCheckpoint(evt.state);
}

function startGame() : void
{
	story.init();
	
	// Run initial listeners for when the game starts
	for (let n = 0; n < story.loadListeners.length; n++) {
		story.loadListeners[n]();
	}
	
	// Show any bad links found
	let areAllLinksOk = tweeTsHelpers.getBadLinksReport( (text) => {
		if (!story.ignoreBadLinks) {
			let logline = $('<div></div>').append(text);
			$('#passage').append(logline);
		} else {
			console.log(text);
		}
	});
	if (!areAllLinksOk && !story.ignoreBadLinks) {
		let ok = $('<div><a href="javascript:void(0)">Continue</a></div>');
		$('#passage').append(ok);
		$('a', ok).click( (evt) => story.showFirstPassage() );
	} else {
		story.showFirstPassage();
	}
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

function include(passage: Passage) : PassageOutput
{
	// Get the current output context
	var output = story.runPassage(passage);
	story.currentPassageOutput().mergeIn(output);
	return output;
}

function fallthrough(passage: Passage) : PassageOutput
{
	story.currentPassage = passage;
	var output = include(passage);
	story.currentPassageOutput().copyTagsFrom(output.tags);
	return output;
}

function popup(passage: Passage) : void
{
	var output = story.runPassage(passage);
	output.renderedHtml = story.parseMarkdown(output.output);
	story.popup(output.renderedHtml);
}

function fnlink(fun : () => void) : string
{
	let funNum = story.functionLinkCount;
	story.functionLinkCount++;
	story.functionLinkMap[funNum] = fun;
	return TWINETS_FUNCTION_SCHEMA + funNum;
}

function runAfter(fun : () => void) : void
{
	story.runAfterFunctions.push(fun);
}
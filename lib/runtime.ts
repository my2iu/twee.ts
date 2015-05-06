// Declare the external Markdown processor

declare var marked : any;


class Passage {
    constructor(public name : string, public codename: string, public code :() => string) {
    }
}

var passages : Passage[] = [];

function htmlEscape(str : string) : string {
	return $("<div>").text(str).html();
}

const TWINETS_PASSAGE_SCHEMA = 'twine.ts+passage:';

class Story {
	startPassageName: string = 'Start';
	passageMap: { [key:string]:Passage } = {};
	
	constructor() {
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
			var split = link.split('->');
			if (split.length > 0) {
				dest = split[1];
				anchorText = split[0];
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
	
	show(passage : Passage) : void {
		// Run the passage code to get the Markdown to show
		var text = passage.code();
		
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

var story : Story;

function startGame() : void
{
	story = new Story();
	story.show(story.passageMap[story.startPassageName]);
}

// Make sure all other initialization code has run first 
// before starting up the engine
setTimeout(() => { startGame(); }, 0);

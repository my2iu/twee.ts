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

class Story {
	startPassageName: string = 'Passage1';//'Start';
	passageMap: { [key:string]:Passage } = {};
	
	constructor() {
		// Make a proper map of all the passages
		passages.forEach((passage) => {
			this.passageMap[passage.name] = passage;
		});
	}
	
	parseMarkdown(text) {
		var lexer = new marked.Lexer();
		
		// Do an initial pass over the code to handle Twine Harlowe-style links
		text.replace(/\[\[(.*?)\]\]/g, function(match, link) {
			var dest = link;
			var anchorText = link;
			return '<a href="' + anchorText + '">' + anchorText + '</a>';
		});
		
		// Disable the handling of 4 spaces at the front of a line meaning
		// a code block because you might have inlined some stuff that inserts
		// some spaces there, triggering a code block unintentionally
		lexer.rules.code = {exec: function() {return null; }};
		return marked.parser(lexer.lex(text));
	}
	
	show(passage : Passage) {
		var text = passage.code();
		$("#passage").html(this.parseMarkdown(text));
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

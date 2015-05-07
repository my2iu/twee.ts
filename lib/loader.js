"use strict";

/**
 * Imports external files as scripts in the current document.
 */
var importer = {
	importedCount : 1,
	importDone : null,
	decrementImportedCount : function() {
		this.importedCount--;
		if (this.importDone != null && this.importedCount == 0)
			this.importDone();
	},
	onImportDone : function(fn) {
		this.importDone = fn;
		this.decrementImportedCount();
	},
	importScriptFile : function(fileName, type) {
		this.importedCount++;
		var parent = this;
		$.get(fileName, function(data) {
			var s = $('<script><' + '/script>')
				.attr('type', type)
				.attr('data-filename', fileName)
				.text(data);
			$('head').append(s);
			parent.decrementImportedCount();
		});
	},
	importTweeTs : function(fileName) {
		this.importScriptFile(fileName, 'twee.ts');
	},
	importTsSrc : function (fileName) {
		this.importScriptFile(fileName, 'typescript');
	}
};




/**
 * Finds all Typescript scripts, translates them to a single JavaScript file
 * and includes that code in the document to run it.
 */
function compileTs(files, errorReporter)
{
	var compilerHost = {
		getSourceFile: function(fileName, langVersion) {
			var s = $("script[type='typescript'][data-filename='" + fileName + "']").first();
			return ts.createSourceFile(fileName, s.text(), langVersion);
		},
		getDefaultLibFileName : function(options) {
			return "lib/lib.d-1.5beta.ts";
		},
		writeFile : function(fileName, data, bom) {
			var s = $('<script><' + '/script>').text(data).attr('data-filename', fileName);
			// Append a filename comment at the end so that Chrome will show
			// the file in the debugger
			s.append('\n//@ sourceURL=' + fileName);
			$('head').append(s);
		},
		getCurrentDirectory : function() {
			return '';
		},
		getCanonicalFileName : function(fileName) {
			return fileName;
		},
		useCaseSensitiveFileNames : function() {
			return true;
		},
		getNewLine : function() {
			return '\n';
		}
	};
	var tsCompilation = ts.createProgram(files,
		{noEmitOnError: true, noImplicitAny: false,
		target: ts.ScriptTarget.ES5,
		module: ts.ModuleKind.CommonJS,
		out: 'transpiled.js'},
		compilerHost);
	var result = tsCompilation.emit();
	result.diagnostics = ts.getPreEmitDiagnostics(tsCompilation).concat(result.diagnostics);
	return result;
}


/**
 * Translates Twee.ts code to Typescript
 */
var tweeTsToTs = {
	passageNames : [],
	passageClassCount : 0,
	bookScriptTag : null,
	compile : function () {
		// Create a book script tag to hold static passage info that should
		// be defined first
		this.bookScriptTag = $('<script><' + '/script>')
			.attr('type', 'typescript')
			.attr('data-filename', 'book.ts');
		$('head').append(this.bookScriptTag);
	
		// Now read in all the code and generate code for all of them.
		var untitledCount = 0;
		var parent = this;
		var scripts = $("script[type='twee.ts']")
		//	.filter(function(idx, el) { return $.inArray(el.getAttribute('filename'), files); });
			.each(function(idx, el) {
				// Create a script tag in the current document to hold the 
				// generated typescript
				var fileName = el.getAttribute('data-filename');
				if (!fileName) 
				{
					untitledCount++;
					fileName = '_' + untitledCount;
				}
				var s = $('<script><' + '/script>')
					.attr('type', 'typescript')
					.attr('data-filename', fileName + '.ts');
				$('head').append(s);
				
				// Start generating some code now 
				s.append(document.createTextNode('module PassageClasses {'));
				var text = el.textContent;
				text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				parent.tweeTsLex(text, s);
				s.append(document.createTextNode('}'));
			});
		this.outputBookTo(this.bookScriptTag);
	},
	outputBookTo : function(outputElement)
	{
		var code = 'var book = {\n';
		for (var n = 0; n < this.passageNames.length; n++)
		{
			var passage = this.passageNames[n];
			code += '\t' + this.passageCodeName(passage) + ' : <Passage>null,\n';
		}
		code += '};\n';
		outputElement.append(document.createTextNode(code));
	},
	strEscape : function(str) { 
		return str.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"')
			.replace(/\n/g, '\\n"\n+"')
			.replace(/\r/g, '\\r'); 
	},
	passageCodeName : function(str)
	{
		var symbolized = str.replace(/\W/g, '_');
		if (symbolized.charAt(0).match(/\d/))
			symbolized = '_' + symbolized;
		return symbolized;
	},
	tweeTsLex : function(text, outputElement)
	{
		var pos = 0;
		var passageLine = null;
		var passageText = '';
		// TODO: some scheme to allow for comments that span across passages so that
		//    you can easily comment out passages
		while(true) {
			var newLine = text.indexOf("\n", pos);
			var line = (newLine < 0 ? text.substring(pos) : text.substring(pos, newLine + 1));
			
			if (line.trim().indexOf("::") == 0)
			{
				this.handlePassage(passageLine, passageText, outputElement);
				passageLine = line;
				passageText = '';
			}
			else
			{
				passageText += line;
			}
			
			if (newLine < 0) break;
			pos = newLine + 1;
		}
		this.handlePassage(passageLine, passageText, outputElement);
		
	},
	handlePassage : function(passageLine, passage, outputElement) {
		// Parse the name of the passage and its tags
		if (passageLine == null) return;
		var match = /\s*::\s*(\S[^\[]*)(.*)/.exec(passageLine);
		if (!match) return;
		var passageName = match[1].trim();
		var tags = [];
		var rest = match[2];
		var tagRegex = /\s*\[([^\]]*)\](.*)/;
		match = tagRegex.exec(rest);
		while (match)
		{
			tags.push(match[1]);
			rest = match[2];
			match = tagRegex.exec(rest);
		}
		
		var substituted = '';
		var pos = 0;
		
		// Match whitespace at the beginning so that we can trim it from the Markdown output 
		// (but we preserve the lines in the output to ensure that line numbers approximately match)
		var whitespaceRegex = /\s*/g;
		match = whitespaceRegex.exec(passage);
		pos = whitespaceRegex.lastIndex;
		for (var n = 0; n < match[0].split("\n").length - 1; n++) substituted += '\n';
		
		// Do the templating stuff
		substituted += '_$_ .out("';
		
		var templateRegex = /<%(.*?)%>/g;
		templateRegex.lastIndex = pos;
		match = templateRegex.exec(passage);
		while (match != null) {
			substituted += this.strEscape(passage.substring(pos, match.index));
			var contents = match[1];
			if (contents.length > 0 && contents.charAt(0) == '=') {
				if (contents.length > 1 && contents.charAt(1) == '=')  {
					substituted += '"); _$_.out(' + contents.substring(2) + '); _$_.out("';
				} else {
					substituted += '"); _$_.out(htmlEscape(' + contents.substring(1) + ')); _$_.out("';
				}
			} else {
				substituted += '"); ' + contents + ';_$_.out("';
			}
			pos = templateRegex.lastIndex;
			match = templateRegex.exec(passage);
		}
		// Trim whitespace at the end from the Markdown output 
		// (but we preserve the lines in the output to ensure that line numbers approximately match)
		var whitespaceEndRegex = /(.*?)(\s*)$/g;
		whitespaceEndRegex.lastIndex = pos;
		match = whitespaceEndRegex.exec(passage);
		substituted += this.strEscape(match[1]) + '");';
		for (var n = 0; n < match[2].split("\n").length - 2; n++) substituted += '\n';

		this.outputPassage(passageName, substituted, tags, outputElement);
	},
	outputPassage(passageName, passageCode, tags, outputElement) {
		var code =  '';
		
		// Wrap everything in a function so that we can create variables
		// without polluting the namespace
		//code += '(() => {';
		
		// Output a class for the Passage (this allows the code to access "this")
		var className = 'PassageClass' + this.passageClassCount;
		this.passageClassCount++;
		code += 'class ' + className + ' extends Passage { constructor() { '
			+ 'super("' + this.strEscape(passageName)+ '", '
			+ '"' + this.strEscape(this.passageCodeName(passageName)) + '",'
			+ '[';
		for (var n = 0; n < tags.length; n++) {
			code += '"' + this.strEscape(tags[n]) + '",';
		}
		code += ']';
		code += ');} ';
			
		// Output the main code for the passage
		code += 'run(_$_ : PassageOutput) : void {\n' 
			+ passageCode
			+ '; }'
			
		// Finish outputting the class
		code += '}; ';
			
		// Create an instance of that class
		code += 'passages.push(book.' + this.passageCodeName(passageName) + ' = new ' + className + '());';
			
		// Execute the function
		//code += '})();\n';
		code += '\n';
			
		this.passageNames.push(passageName);
		outputElement.append(document.createTextNode(code));
	}
};



// When the document is loaded and all the imports have been specified,
// we can go about waiting for all the imports to load in and then to 
// compile all the imports.
$(document).ready(function() {
	importer.onImportDone(function() {
		tweeTsToTs.compile();
		
		// Gather all the typescript files for compilation
		var tsFiles = $("script[type='typescript']").map(
			function(idx, el) {return el.getAttribute('data-filename');});
		var result = compileTs(tsFiles);
		for (var n = 0; n < result.diagnostics.length; n++)
		{
			var diagnostic = result.diagnostics[n];
			var lineChar = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
			var message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
			var messageLine = diagnostic.file.fileName +  ' (' + (lineChar.line + 1) + ':' + (lineChar.character + 1) + '): ' + message; 
			if (result.emitSkipped) {
				// Log errors right to the main window
				$('#passage').append($("<div>").text(messageLine));
			} else {
				// We were able to compile successfully, so just log warnings to console
				console.log(messageLine);
			}
		}
	});
});

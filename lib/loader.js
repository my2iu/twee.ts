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
	importTs : function (fileName) {
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
	passageOutLinks : {},
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
		// Create a hierarchy tree of all the passages so that it will be easier
		// to generate a class matching the shape
		var root = {};
		for (var n = 0; n < this.passageNames.length; n++)
		{
			var path = root;
			var pathComponents = this.passageNames[n].split('/');
			// TODO: Check for name collisions
			for (var i = 1; i < pathComponents.length - 1; i++)
			{
				var component = this.passageCodeName(pathComponents[i]);
				if (path[component] == null)
					path[component] = {};
				path = path[component];
			}
			path[this.passageCodeName(pathComponents[pathComponents.length - 1])] = true;
		}
		
		// Now traverse the tree and output the 
		var code = 'var book = {\n';
		code += this.createBookSubTree(root, '');
		code += '};\n';
		outputElement.append(document.createTextNode(code));
	},
	createBookSubTree : function(subtree, indents) {
		var code = '';
		for (var key in subtree)
		{
			if (subtree[key] == true)
				code += indents + '\t' + this.passageCodeName(key) + ' : <Passage>null,\n';
			else
				code += indents + '\t' + this.passageCodeName(key) + ' : {\n'
					+ this.createBookSubTree(subtree[key], indents + '\t')
					+ indents + '\t},\n';
		}
		return code;
	},
	strEscape : function(str) { 
		return str.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"')
			.replace(/\n/g, '\\n"\n+"')
			.replace(/\r/g, '\\r'); 
	},
	newLines : function(num) {
		var toReturn = '';
		for (var n = 0; n < num; n++) toReturn += '\n';
		return toReturn;
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
		var pathBase = '/';
		// TODO: some scheme to allow for comments that span across passages so that
		//    you can easily comment out passages
		while(true) {
			var newLine = text.indexOf("\n", pos);
			var line = (newLine < 0 ? text.substring(pos) : text.substring(pos, newLine + 1));
			
			if (line.trim().indexOf("::") == 0)
			{
				this.handlePassage(passageLine, passageText, pathBase, outputElement);
				passageText = '';
				if (line.trim().indexOf(":::") == 0)
				{
					passageLine = null;
					var tags = this.extractPassageLineTags(line);
					for (var n = 0; n < tags.length; n++) 
						if (tags[n].indexOf('module=') == 0) 
							pathBase = tags[n].substring('module='.length) + '/';
				}
				else
				{
					passageLine = line;
				}
			}
			else
			{
				passageText += line;
			}
			
			if (newLine < 0) break;
			pos = newLine + 1;
		}
		this.handlePassage(passageLine, passageText, pathBase, outputElement);
	},
	simplifyPassageName : function(namePath) {
		// Remove all repeated slashes
		namePath = namePath.replace(/\/+/g, '/');
		// Add a slash at the beginning if necessary
		if (namePath.charAt(0) != '/') namePath = '/' + namePath;
		return namePath;
	},
	extractPassageLineName : function(passageLine, pathBase) {
		// Parse the name of the passage
		var match = /\s*::\s*(\S[^\[]*)(.*)/.exec(passageLine);
		if (!match) return null;
		var passageName = this.simplifyPassageName(pathBase + match[1].trim());
		return passageName;
	},
	extractPassageLineTags : function(passageLine) {
		// Parse the tags
		if (passageLine == null) return;
		var tags = [];
		var rest = passageLine;
		var tagRegex = /[^\[]*\[([^\]]*)\](.*)/;
		var match = tagRegex.exec(rest);
		while (match)
		{
			var tag = match[1];
			var equal = tag.indexOf('='); 
			if (equal >= 0) 
			{
				var key = tag.substring(0, equal);
				var val = tag.substring(equal + 1);
				tag = key.trim() + '=' + val.trim();
			}
			tags.push(tag);
			rest = match[2];
			match = tagRegex.exec(rest);
		}
		return tags;
	},
	handlePassage : function(passageLine, passage, pathBase, outputElement) {
		// Parse the name of the passage and its tags
		if (passageLine == null) return;
		var passageName = this.extractPassageLineName(passageLine, pathBase);
		if (!passageName) return;
		var tags = this.extractPassageLineTags(passageLine);
		
		var substituted = '';
		var pos = 0;
		
		// Match whitespace at the beginning so that we can trim it from the Markdown output 
		// (but we preserve the lines in the output to ensure that line numbers approximately match)
		var whitespaceRegex = /^\s*/g;
		var match = whitespaceRegex.exec(passage);
		pos = whitespaceRegex.lastIndex;
		substituted += this.newLines(match[0].split("\n").length - 1);
		
		// Do the templating stuff
		substituted += '_$_ .out("';
		
		var templateRegex = /<%(.*?)%>/g;
		templateRegex.lastIndex = pos;
		match = templateRegex.exec(passage);
		while (match != null) {
			var markdownText = passage.substring(pos, match.index);
			substituted += this.strEscape(markdownText);
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
		var whitespaceEndRegex = /(\s*)$/g;
		whitespaceEndRegex.lastIndex = pos;
		match = whitespaceEndRegex.exec(passage);
		if (!match)
			substituted += this.strEscape(passage.substring(pos)) + '");';
		else
			substituted += this.strEscape(passage.substring(pos, match.index)) + '");';
		substituted += this.newLines(match[1].split("\n").length - 2);

		this.outputPassage(passageName, substituted, tags, outputElement);
	},
	outputPassage : function(passageName, passageCode, tags, outputElement) {
		var code =  '';
		
		// Output a class for the Passage (this allows the code to access "this")
		var className = 'PassageClass' + this.passageClassCount;
		this.passageClassCount++;
		code += 'class ' + className + ' extends Passage { ';
		// References to passages in the same scope
		code += 'p=book';
		var pathComponents = passageName.split('/');
		for (var n = 1; n < pathComponents.length - 1; n++) 
			code += '.' + this.passageCodeName(pathComponents[n]);
		code += '; ';
		// Constructor chaining
		code += 'constructor() { '
			+ 'super("' + this.strEscape(passageName)+ '", '
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
		code += 'book';
		var path = passageName.split('/');
		for (var i = 1; i < path.length; i++) code += '.' + this.passageCodeName(path[i]);
		code += ' = new ' + className + '();';
			
		code += '\n';
			
		this.passageNames.push(passageName);
		outputElement.append(document.createTextNode(code));
	}
};

var tweeTsHelpers = {
	canonicalizePassageName : function(base, name)  {
		// If it's an absolute path, then use the root as the base path
		if (name[0] == '/') base = '/';
		
		// Discard the name of the passage in the base, leaving only its directory
		let basePathComponents = base.split('/');
		basePathComponents.pop();

		let pathComponents = name.split('/');
		for (var n = 0; n < pathComponents.length; n++)
		{
			var path = pathComponents[n];
			if (path == '') continue;  // Ignore double slashes: '//'
			if (path == '..') { basePathComponents.pop(); continue; }
			basePathComponents.push(path);
		}
		
		return basePathComponents.join('/');
	}
}

// When the document is loaded and all the imports have been specified,
// we can go about waiting for all the imports to load in and then to 
// compile all the imports.
$(document).ready(function() {
	importer.onImportDone(function() {
		tweeTsToTs.compile();
		
		// Gather all the typescript files for compilation
		var tsFiles = $("script[type='typescript']").map(
			function(idx, el) {return el.getAttribute('data-filename');}).toArray();
		if  ($.inArray('lib/runtime.ts', tsFiles) >= 0) {
			// Put the runtime.ts library at the beginning
			tsFiles.splice($.inArray('lib/runtime.ts', tsFiles), 1);
			tsFiles.unshift('lib/runtime.ts');
		}
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

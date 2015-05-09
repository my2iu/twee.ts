# twee.ts

Twee.ts is a game framework for making text games that run in a web browser. 

It is inspired by Twine/Twee and its Snowman story format. Unlike Twine/Twee, Twee.ts is designed for power users who want to write larger and more complex games. Twee.ts contains features that help you write games at a larger scale:

* it uses Markdown for text so that you don't have to spend as much time managing linebreaks in your programs. This also gives you more flexibility in formatting your code to be easier to read.
* passages can be organized into namespace hierarchies, making it easier to organize your passages without having to worry about clashing names
* Typescript is used as the underlying scripting engine. Although Typescript can be used exactly like normal JavaScript, it also gives you the option of letting the computer automatically check your code for errors. You no longer have to worry about misspelling variables. You can use more descriptive types like enumerations to organize your program.
* Twee.ts can gather your game code, compile it, and run it entirely from within a browser. It is not necessary to have a separate compiler program to create your game.
* the main game engine provides hooks to allow you to easily customize its behavior
* a passage can "fall through" to another passage, providing an easy mechanism for programmatically deciding how one passage should flow to the next
* the engine allows you to save and replay transcripts, making testing easier

Note: Twee.ts is still in development, so it is not ready for use yet.


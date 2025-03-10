/*
 * GNU AGPL-3.0 License
 *
 * Copyright (c) 2021 - present core.ai . All rights reserved.
 * Original work Copyright (c) 2013 - 2021 Adobe Systems Incorporated. All rights reserved.
 *
 * This program is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License
 * for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see https://opensource.org/licenses/AGPL-3.0.
 *
 */

/*global describe, it, expect, beforeEach, afterEach */

define(function (require, exports, module) {


    var SpecRunnerUtils = brackets.getModule("spec/SpecRunnerUtils"),
        testContentCSS  = require("text!unittest-files/regions.css"),
        testContentHTML = require("text!unittest-files/region-template.html"),
        CSSCodeHints    = require("main");

    describe("unit:CSS Code Hinting", function () {

        var defaultContent = "@media screen { \n" +
                             " body { \n" +
                             " }\n" +
                             "} \n" +
                             ".selector { \n" +
                             " \n" +
                             " b\n" +
                             " bord\n" +
                             " border-\n" +
                             " border-colo\n" +
                             " border-color: red;\n" +      // line: 10
                             " d\n" +
                             " disp\n" +
                             " display: \n" +
                             " display: in\n" +
                             " bordborder: \n" +
                             " color\n" +
                             "} \n";

        var defaultHTMLContent = "<html> \n" +
                                 "<head> \n" +
                                 "</head> \n" +
                                 "<body> \n" +
                                 "<div style=' \n" + // line 4
                                 " \n" +
                                 " b\n" +
                                 " bord\n" +
                                 " border-\n" +
                                 " border-colo\n" +
                                 " border-color: red;'>\n" + // line 10
                                 "</div> \n" +
                                 "</body> \n" +
                                 "</html> \n";

        var testDocument, testEditor;

        /*
         * Create a mockup editor with the given content and language id.
         *
         * @param {string} content - content for test window
         * @param {string} languageId
         */
        function setupTest(content, languageId) {
            var mock = SpecRunnerUtils.createMockEditor(content, languageId);
            testDocument = mock.doc;
            testEditor = mock.editor;
        }

        function tearDownTest() {
            SpecRunnerUtils.destroyMockEditor(testDocument);
            testEditor = null;
            testDocument = null;
        }

        function extractHintList(hints) {
            return $.map(hints, function ($node) {
                return $node.data('val');
            });
        }

        // Ask provider for hints at current cursor position; expect it to return some
        function expectHints(provider, implicitChar, returnWholeObj) {
            expect(provider.hasHints(testEditor, implicitChar)).toBe(true);
            var hintsObj = provider.getHints();
            expect(hintsObj).toBeTruthy();
            // return just the array of hints if returnWholeObj is falsy
            return returnWholeObj ? hintsObj : extractHintList(hintsObj.hints);
        }

        // Ask provider for hints at current cursor position; expect it NOT to return any
        function expectNoHints(provider, implicitChar) {
            expect(provider.hasHints(testEditor, implicitChar)).toBe(false);
        }

        function verifyAttrHints(hintList, expectedFirstHint) {
            expect(hintList.indexOf("div")).toBe(-1);
            expect(hintList[0]).toBe(expectedFirstHint);
        }

        function verifySecondAttrHint(hintList, expectedSecondHint) {
            expect(hintList.indexOf("div")).toBe(-1);
            expect(hintList[1]).toBe(expectedSecondHint);
        }

        function selectHint(provider, expectedHint, implicitChar) {
            var hintList = expectHints(provider, implicitChar);
            expect(hintList.indexOf(expectedHint)).not.toBe(-1);
            return provider.insertHint(expectedHint);
        }

        // Helper function for testing cursor position
        function fixPos(pos) {
            if (!("sticky" in pos)) {
                pos.sticky = null;
            }
            return pos;
        }
        function expectCursorAt(pos) {
            var selection = testEditor.getSelection();
            expect(fixPos(selection.start)).toEql(fixPos(selection.end));
            expect(fixPos(selection.start)).toEql(fixPos(pos));
        }

        // Helper function to
        // a) ensure the hintList and the list with the available values have the same size
        // b) ensure that all possible values are mentioned in the hintList
        function verifyAllValues(hintList, values) {
            expect(hintList.length).toBe(values.length);
            expect(hintList.sort().toString()).toBe(values.sort().toString());
        }

        describe("CSS properties in general (selection of correct property based on input)", function () {

            beforeEach(function () {
                // create Editor instance (containing a CodeMirror instance)
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "css");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should list all prop-name hints right after curly bracket", function () {
                testEditor.setCursorPos({ line: 4, ch: 11 });    // after {
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "display");  // filtered on "empty string"
            });

            it("should list all prop-name hints in new line", function () {
                testEditor.setCursorPos({ line: 5, ch: 1 });

                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "display");  // filtered on "empty string"
            });

            it("should list all prop-name hints starting with 'b' in new line", function () {
                testEditor.setCursorPos({ line: 6, ch: 2 });

                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "bottom");  // filtered on "b" ,
                // bottom should come at top as it is coming from emmet, and it has the highest priority
            });

            it("should list the second prop-name hint starting with 'b'", function () {
                testEditor.setCursorPos({ line: 6, ch: 2 });

                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifySecondAttrHint(hintList, "background-color");  // filtered on "b" ,
                // background-color should be displayed at second. as first will be bottom coming from emmet
            });

            it("should list all prop-name hints starting with 'bord' ", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 6, ch: 2 });

                testEditor.setCursorPos({ line: 7, ch: 5 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "border");  // filtered on "bord"
            });

            it("should list all prop-name hints starting with 'border-' ", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 7, ch: 5 });

                testEditor.setCursorPos({ line: 8, ch: 8 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "border-radius");  // filtered on "border-"
            });

            it("should list only prop-name hint border-color", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 8, ch: 8 });

                testEditor.setCursorPos({ line: 9, ch: 12 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider); // filtered on "border-colo"
                verifyAttrHints(hintList, "border-color");  // filtered on "border-color"
                expect(hintList.length).toBe(17);
                expect(hintList[0]).toBe("border-color");
                expect(hintList[1]).toBe("border-collapse: collapse;"); // due to "border-colo" matches in split segment
            });

            it("should list prop-name hints at end of property-value finished by ;", function () {
                testEditor.setCursorPos({ line: 10, ch: 19 });    // after ;
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "display");  // filtered on "empty string"
            });

            it("should NOT list prop-name hints right before curly bracket", function () {
                testEditor.setCursorPos({ line: 4, ch: 10 });    // inside .selector, before {
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should NOT list prop-name hints after declaration of mediatype", function () {
                testEditor.setCursorPos({ line: 0, ch: 15 });    // after {
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should NOT list prop-name hints if previous property is not closed properly", function () {
                testEditor.setCursorPos({ line: 16, ch: 6 });   // cursor directly after color
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });
            it("should NOT list prop-name hints in media type declaration", function () {
                testEditor.setCursorPos({ line: 0, ch: 1 });
                expect(CSSCodeHints.cssPropHintProvider.hasHints(testEditor, 'm')).toBe(false);
            });
        });

        describe("CSS property hint insertion", function () {
            beforeEach(function () {
                // create Editor instance (containing a CodeMirror instance)
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "css");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should insert colon prop-name selected", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 6, ch: 2 });

                testEditor.setCursorPos({ line: 7, ch: 5 });   // cursor after 'bord'
                selectHint(CSSCodeHints.cssPropHintProvider, "border");
                expect(testDocument.getLine(7)).toBe(" border: ");
                expectCursorAt({ line: 7, ch: 9 });
            });

            it("should not insert semicolon after prop-value selected", function () {
                testDocument.replaceRange(";", { line: 12, ch: 5 });
                testEditor.setCursorPos({ line: 13, ch: 10 });   // cursor after 'display: '
                selectHint(CSSCodeHints.cssPropHintProvider, "block");
                expect(testDocument.getLine(13)).toBe(" display: block");
            });

            it("should insert full prop-value hint", function () {
                testDocument.replaceRange(";", { line: 12, ch: 5 });
                testEditor.setCursorPos({ line: 13, ch: 5 });   // cursor after 'display: '
                selectHint(CSSCodeHints.cssPropHintProvider, "display: block;");
                expect(testDocument.getLine(13)).toBe(" display: block;: "); // the : comes from existing location
            });

            it("should insert prop-name directly after semicolon", function () {
                testEditor.setCursorPos({ line: 10, ch: 19 });   // cursor after red;
                selectHint(CSSCodeHints.cssPropHintProvider, "display");
                expect(testDocument.getLine(10)).toBe(" border-color: red;display: ");
            });

            it("should insert nothing but the closure(semicolon) if prop-value is fully written", function () {
                testDocument.replaceRange(";", { line: 15, ch: 13 }); // insert text ;
                testEditor.setCursorPos({ line: 16, ch: 6 });   // cursor directly after color
                selectHint(CSSCodeHints.cssPropHintProvider, "color");
                expect(testDocument.getLine(16)).toBe(" color: ");
                expectCursorAt({ line: 16, ch: 8 });
            });

            it("should insert prop-name before an existing one", function () {
                testEditor.setCursorPos({ line: 10, ch: 1 });   // cursor before border-color:
                selectHint(CSSCodeHints.cssPropHintProvider, "margin");
                expect(testDocument.getLine(10)).toBe(" margin:  border-color: red;");
                expectCursorAt({ line: 10, ch: 9 });
            });

            it("should insert prop-name before an existing one when invoked with an implicit character", function () {
                testDocument.replaceRange("f", { line: 10, ch: 1 }); // insert "f" before border-color:
                testEditor.setCursorPos({ line: 10, ch: 2 });        // set cursor before border-color:
                selectHint(CSSCodeHints.cssPropHintProvider, "float", "f");
                expect(testDocument.getLine(10)).toBe(" float:  border-color: red;");
                expectCursorAt({ line: 10, ch: 8 });
            });

            it("should replace the existing prop-value with the new selection", function () {
                testDocument.replaceRange(";", { line: 12, ch: 5 });
                testDocument.replaceRange("block", { line: 13, ch: 10 });
                testEditor.setCursorPos({ line: 13, ch: 10 });   // cursor before block
                selectHint(CSSCodeHints.cssPropHintProvider, "none");
                expect(testDocument.getLine(13)).toBe(" display: none");
                expectCursorAt({ line: 13, ch: 14 });
            });
        });

        describe("CSS prop-value hints", function () {
            beforeEach(function () {
                // create Editor instance (containing a CodeMirror instance)
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "css");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should list all prop-values for 'display' after colon", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 12, ch: 5 });

                testEditor.setCursorPos({ line: 13, ch: 9 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "block");  // filtered after "display:"
            });

            it("should list all prop-values for 'display' after colon and whitespace", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 12, ch: 5 });

                testEditor.setCursorPos({ line: 13, ch: 10 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "block");  // filtered after "display: "
            });

            it("should list all prop-values starting with 'in' for 'display' after colon and whitespace", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 13, ch: 10 });

                testEditor.setCursorPos({ line: 14, ch: 12 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "inline");  // filtered after "display: in"
            });

            it("should NOT list prop-value hints for unknown prop-name", function () {
                testEditor.setCursorPos({ line: 15, ch: 12 });  // at bordborder:
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

        });

        describe("CSS hint provider inside mixed htmlfiles", function () {
            var defaultContent = "<html> \n" +
                                 "<head><style>.selector{display: none;}</style></head> \n" +
                                 "<body> <style> \n" +
                                 " body { \n" +
                                 "    background-color: red; \n" +
                                 " \n" +
                                 "} \n" +
                                 "</style>\n" +
                                 "<div class='selector'></div>\n" +
                                 "<style> .foobar { \n" +
                                 " colo </style>\n" +
                                 "</body></html>";

            beforeEach(function () {
                // create dummy Document for the Editor
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "html");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should list prop-name hints right after curly bracket", function () {
                testEditor.setCursorPos({ line: 3, ch: 7 });  // inside body-selector, after {
                expectHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should list prop-name hints inside single-line styletags at start", function () {
                testEditor.setCursorPos({ line: 1, ch: 23 });  // inside style, after {
                expectHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should list prop-name hints inside single-line styletags after semicolon", function () {
                testEditor.setCursorPos({ line: 1, ch: 37 });  // inside style, after ;
                expectHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should list prop-name hints inside multi-line styletags with cursor in first line", function () {
                testEditor.setCursorPos({ line: 9, ch: 18 });   // inside style, after {
                expectHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should list prop-name hints inside multi-line styletags with cursor in last line", function () {
                testEditor.setCursorPos({ line: 10, ch: 5 });    // inside style, after colo
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                expect(hintList.length).toBe(50);
                expect(hintList[0]).toBe("color");
                expect(hintList[1]).toBe("color-adjust");
            });

            it("should NOT list prop-name hints between closed styletag and new opening styletag", function () {
                testEditor.setCursorPos({ line: 8, ch: 0 });    // right before <div
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should NOT list hints right before curly bracket", function () {
                testEditor.setCursorPos({ line: 3, ch: 6 });    // inside body-selector, before {
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should NOT list hints inside head-tag", function () {
                testEditor.setCursorPos({ line: 1, ch: 6 });    // between <head> and </head> {
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

        });

        describe("CSS Hint provider in style attribute value context for html mode", function () {

            beforeEach(function () {
                // create Editor instance (containing a CodeMirror instance)
                var mock = SpecRunnerUtils.createMockEditor(defaultHTMLContent, "html");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should list all prop-name hints right after the open quote for style value context", function () {
                testEditor.setCursorPos({ line: 4, ch: 12 });    // after "='"
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "display");  // filtered on "empty string"
            });

            it("should list all prop-name hints in new line for style value context", function () {
                testEditor.setCursorPos({ line: 5, ch: 0 });

                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "display");  // filtered on "empty string"
            });

            it("should list all prop-name hints starting with 'b' in new line for style value context", function () {
                testEditor.setCursorPos({ line: 6, ch: 2 });

                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "bottom");  // filtered on "b"
            });

            it("should list the second prop-name hint starting with 'b' for style value context", function () {
                testEditor.setCursorPos({ line: 6, ch: 2 });

                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifySecondAttrHint(hintList, "background-color");  // second result when filtered on "b"
            });

            it("should list all prop-name hints starting with 'bord' for style value context", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 6, ch: 2 });

                testEditor.setCursorPos({ line: 7, ch: 5 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "border");  // filtered on "bord"
            });

            it("should list all prop-name hints starting with 'border-' for style value context", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 7, ch: 5 });

                testEditor.setCursorPos({ line: 8, ch: 8 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "border-radius");  // filtered on "border-"
            });

            it("should list only prop-name hint border-color for style value context", function () {
                // insert semicolon after previous rule to avoid incorrect tokenizing
                testDocument.replaceRange(";", { line: 8, ch: 8 });

                testEditor.setCursorPos({ line: 9, ch: 12 });
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                expect(hintList.length).toBe(17);
                expect(hintList[0]).toBe("border-color");
                expect(hintList[1]).toBe("border-collapse: collapse;");
            });

            it("should list prop-name hints at end of property-value finished by ; for style value context", function () {
                testEditor.setCursorPos({ line: 10, ch: 19 });    // after ;
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "display");  // filtered on "empty string"
            });

            it("should NOT list prop-name hints right before style value context", function () {
                testEditor.setCursorPos({ line: 4, ch: 11 });    // after =
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

            it("should NOT list prop-name hints after style value context", function () {
                testEditor.setCursorPos({ line: 10, ch: 20 });    // after "'"
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });

        });


        describe("CSS hint provider in other filecontext (e.g. javascript)", function () {
            var defaultContent = "function foobar (args) { \n " +
                                 "    /* do sth */ \n" +
                                 "    return 1; \n" +
                                 "} \n";
            beforeEach(function () {
                // create dummy Document for the Editor
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "javascript");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should NOT list hints after function declaration", function () {
                testEditor.setCursorPos({ line: 0, ch: 24 });    // after {  after function declaration
                expectNoHints(CSSCodeHints.cssPropHintProvider);
            });
        });

        describe("CSS hint provider cursor placement inside value functions", function () {
            var defaultContent = ".selector { \n" + // line 0
                                 "shape-inside:\n" + // line 1
                                 "}\n"; // line 2

            beforeEach(function () {
                // create dummy Document for the Editor
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "css");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should should place the cursor between the parens of the value function", function () {
                var expectedString = "shape-inside:polygon()";

                testEditor.setCursorPos({ line: 1, ch: 15 });    // after shape-inside
                expectHints(CSSCodeHints.cssPropHintProvider);
                selectHint(CSSCodeHints.cssPropHintProvider, "polygon()");
                expect(testDocument.getLine(1).length).toBe(expectedString.length);
                expect(testDocument.getLine(1)).toBe(expectedString);
                expectCursorAt({ line: 1, ch: expectedString.length - 1 });
            });
        });

        describe("CSS hint provider for regions and exclusions", function () {
            var defaultContent = ".selector { \n" + // line 0
                                 " shape-inside: \n;" + // line 1
                                 " shape-outside: \n;" + // line 2
                                 " region-fragment: \n;" + // line 3
                                 " region-break-after: \n;" + // line 4
                                 " region-break-inside: \n;" + // line 5
                                 " region-break-before: \n;" + // line 6
                                 " -ms-region\n;" + // line 7
                                 " -webkit-region\n;" + // line 8
                                 " flow-from: \n;" + // line 9
                                 " flow-into: \n;" + // line 10
                                 "}\n"; // line 11

            beforeEach(function () {
                // create dummy Document for the Editor
                var mock = SpecRunnerUtils.createMockEditor(defaultContent, "css");
                testEditor = mock.editor;
                testDocument = mock.doc;
            });

            afterEach(function () {
                SpecRunnerUtils.destroyMockEditor(testDocument);
                testEditor = null;
                testDocument = null;
            });

            it("should list 7 value-name hints for shape-inside", function () {
                testEditor.setCursorPos({ line: 1, ch: 15 });    // after shape-inside
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "auto");  // first hint should be auto
                verifyAllValues(hintList, [
                    "auto","calc()","circle()","ellipse()","inherit","initial","outside-shape","polygon()",
                    "rectangle()","unset","var()"
                ]);
            });

            it("should list 36 value-name hints for shape-outside", function () {
                testEditor.setCursorPos({ line: 2, ch: 16 });    // after shape-outside
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "border-box");  // first hint should be border-box
                verifyAllValues(hintList, [
                    "-moz-element()",
                    "-moz-linear-gradient()",
                    "-moz-radial-gradient()",
                    "-moz-repeating-linear-gradient()",
                    "-moz-repeating-radial-gradient()",
                    "-o-linear-gradient()",
                    "-o-repeating-linear-gradient()",
                    "-webkit-gradient()",
                    "-webkit-image-set()",
                    "-webkit-linear-gradient()",
                    "-webkit-radial-gradient()",
                    "-webkit-repeating-linear-gradient()",
                    "-webkit-repeating-radial-gradient()",
                    "border-box",
                    "calc()",
                    "circle()",
                    "content-box",
                    "cross-fade()",
                    "element()",
                    "ellipse()",
                    "image()",
                    "image-set()",
                    "inherit",
                    "initial",
                    "inset()",
                    "linear-gradient()",
                    "margin-box",
                    "none",
                    "padding-box",
                    "polygon()",
                    "radial-gradient()",
                    "repeating-linear-gradient()",
                    "repeating-radial-gradient()",
                    "unset",
                    "url()",
                    "var()"]
                );
            });

            it("should list 2 value-name hints for region-fragment", function () {
                testEditor.setCursorPos({ line: 3, ch: 18 });    // after region-fragment
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "auto");  // first hint should be auto
                verifyAllValues(hintList, [
                    "auto",
                    "break",
                    "calc()",
                    "inherit",
                    "initial",
                    "unset",
                    "var()"
                ]);
            });

            it("should list 11 value-name hints for region-break-after", function () {
                testEditor.setCursorPos({ line: 4, ch: 21 });    // after region-break-after
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "always");  // first hint should be always
                verifyAllValues(hintList, [
                    "always",
                    "auto",
                    "avoid",
                    "avoid-column",
                    "avoid-page",
                    "avoid-region",
                    "calc()",
                    "column",
                    "inherit",
                    "initial",
                    "left",
                    "page",
                    "region",
                    "right",
                    "unset",
                    "var()"
                ]);
            });

            it("should list 5 value-name hints for region-break-inside", function () {
                testEditor.setCursorPos({ line: 5, ch: 22 });    // after region-break-inside
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "auto");  // first hint should be auto
                verifyAllValues(hintList, [
                    "auto",
                    "avoid",
                    "avoid-column",
                    "avoid-page",
                    "avoid-region",
                    "calc()",
                    "inherit",
                    "initial",
                    "unset",
                    "var()"
                ]);
            });

            it("should list 11 value-name hints for region-break-before", function () {
                testEditor.setCursorPos({ line: 6, ch: 23 });    // after region-break-before
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "always");  // first hint should be always
                verifyAllValues(hintList, [
                    "always",
                    "auto",
                    "avoid",
                    "avoid-column",
                    "avoid-page",
                    "avoid-region",
                    "calc()",
                    "column",
                    "inherit",
                    "initial",
                    "left",
                    "page",
                    "region",
                    "right",
                    "unset",
                    "var()"
                ]);
            });
        });

        describe("Color names and swatches in a CSS file", function () {
            beforeEach(function () {
                setupTest(testContentCSS, "css");
            });

            afterEach(function () {
                tearDownTest();
            });

            it("should list color names for color", function () {
                testEditor.setCursorPos({ line: 98, ch: 11 }); // after color
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "aliceblue"); // first hint should be aliceblue
            });

            it("should show color swatches for background-color", function () {
                testEditor.setCursorPos({ line: 99, ch: 22 }); // after background-color
                var hints = expectHints(CSSCodeHints.cssPropHintProvider, undefined, true).hints;
                expect(hints[0].text()).toBe("aliceblue"); // first hint should be aliceblue
                expect(hints[0].find(".color-swatch").length).toBe(1);
                // CEF 2623 will output "aliceblue" whereas earlier versions give "rgb(240, 248, 255)",
                // so we need this ugly hack to make sure this test passes on both
                expect(hints[0].find(".color-swatch").css("backgroundColor")).toMatch(/^rgb\(240, 248, 255\)$|aliceblue/);
            });

            it("should filter out color names appropriately", function () {
                testEditor.setCursorPos({ line: 100, ch: 27 }); // after border-left-color
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hintList, "deeppink"); // first hint should be deeppink
                verifyAllValues(hintList, ["deeppink", "deepskyblue"]);
            });

            it("should always include transparent and currentColor and they should not have a swatch, but class no-swatch-margin", function () {
                testEditor.setCursorPos({ line: 101, ch: 22 }); // after border-color
                var hints = expectHints(CSSCodeHints.cssPropHintProvider, undefined, true).hints,
                    hintList = extractHintList(hints);
                verifyAttrHints(hintList, "currentColor"); // first hint should be currentColor
                verifyAllValues(hintList, ["currentColor", "transparent"]);
                expect(hints[0].find(".color-swatch").length).toBe(0); // no swatch for currentColor
                expect(hints[1].find(".color-swatch").length).toBe(0); // no swatch for transparent
                expect(hints[0].hasClass("no-swatch-margin")).toBeTruthy(); // no-swatch-margin applied to currentColor
                expect(hints[1].hasClass("no-swatch-margin")).toBeTruthy(); // no-swatch-margin applied to transparent
            });

            it("should insert color names correctly", function () {
                var expectedString  = "    border-left-color: deeppink;",
                    line            = 100;

                testEditor.setCursorPos({ line: line, ch: 27 }); // after border-left-color
                expectHints(CSSCodeHints.cssPropHintProvider);
                selectHint(CSSCodeHints.cssPropHintProvider, "deeppink");
                expect(testDocument.getLine(line).length).toBe(expectedString.length);
                expect(testDocument.getLine(line)).toBe(expectedString);
                expectCursorAt({ line: line, ch: expectedString.length - 1 });
            });


            it("should not display color names for unrelated properties", function () {
                testEditor.setCursorPos({ line: 102, ch: 12 }); // after height
                var hintList = expectHints(CSSCodeHints.cssPropHintProvider);
                expect(hintList.indexOf("aliceblue")).toBe(-1);
            });
        });

        describe("Should not invoke CSS hints on space key", function () {
            beforeEach(function () {
                setupTest(testContentHTML, "html");
            });

            afterEach(function () {
                tearDownTest();
            });

            it("should not trigger CSS property name hints with space key", function () {
                testEditor.setCursorPos({ line: 25, ch: 11 });    // after {
                expectNoHints(CSSCodeHints.cssPropHintProvider, " ");
            });

            it("should not trigger CSS property value hints with space key", function () {
                testEditor.setCursorPos({ line: 28, ch: 21 });    // after flow-from
                expectNoHints(CSSCodeHints.cssPropHintProvider, " ");
            });
        });


        const emmetContent = "body {\n" +
                             "  m\n" +
                             "  bgc\n" +
                             "  m0\n" +
                             "  pt10\n" +
                             "  ma\n" +
                             "}";

        describe("Emmet hints for CSS", function () {

            beforeEach(function () {
                setupTest(emmetContent, "css");
            });

            afterEach(function () {
                tearDownTest();
            });

            it("should display emmet hint margin when m is pressed", function () {
                testEditor.setCursorPos({ line: 1, ch: 3 });
                const hints = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hints, "margin");
                expect(hints.indexOf("margin")).toBe(0);
            });

            it("should display emmet hint background-color when bgc is pressed", function () {
                testEditor.setCursorPos({ line: 2, ch: 5 });
                const hints = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hints, "background-color");
                expect(hints.indexOf("background-color")).toBe(0);
            });

            it("should complete margin property when m0 is pressed", function () {
                testEditor.setCursorPos({ line: 3, ch: 4 });
                const hints = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hints, "margin: 0;");
                expect(hints.indexOf("margin: 0;")).toBe(0);

                selectHint(CSSCodeHints.cssPropHintProvider, "margin: 0;");
                expect(testDocument.getLine(3)).toBe("  margin: 0;");
                expectCursorAt({ line: 3, ch: 12 });
            });

            it("should complete padding-top property when pt10 is pressed", function () {
                testEditor.setCursorPos({ line: 4, ch: 6 });
                const hints = expectHints(CSSCodeHints.cssPropHintProvider);
                verifyAttrHints(hints, "padding-top: 10px;");
                expect(hints.indexOf("padding-top: 10px;")).toBe(0);

                selectHint(CSSCodeHints.cssPropHintProvider, "padding-top: 10px;");
                expect(testDocument.getLine(4)).toBe("  padding-top: 10px;");
                expectCursorAt({ line: 4, ch: 20 });
            });

            it("should not hint margin when ma is pressed", function () {
                testEditor.setCursorPos({ line: 5, ch: 4 });
                const hints = expectHints(CSSCodeHints.cssPropHintProvider);
                expect(hints.indexOf("margin")).toBe(1); // this should not be 0, as max-width comes first
            });

        });
    });
});

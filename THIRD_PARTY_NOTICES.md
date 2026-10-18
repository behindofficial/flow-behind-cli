# Attribution and provenance

Flow Behind CLI is a refactored derivative of the supplied **flow-connector-cli
1.0.9**, whose package metadata names **Srijan Kaiwart** as author and **MIT**
as its license. The supplied distribution did not include its advertised LICENSE
file or original TypeScript source. Attribution is retained here and in adapted
source modules. It is not an independently invented implementation of every
algorithm. No ownership of upstream code or the companion extension is claimed.

The CLI's bundled application sections were recovered into editable ES modules.
CLI and MCP now share the schemas, bridge and client implementation. The client,
job store, brand configuration, build tooling, inpainting runner and tests include
new implementations. The bundled copy of Zod was replaced with the normal Zod
dependency. Runtime dependencies retain their own licenses in node_modules.

The browser extension remains **Flow Connector**. References to that name in
connection instructions identify the actual required extension, not this CLI's
brand. The upstream configuration URL provides compatibility notices about that
extension. Its latest CLI version is not presented as a Flow Behind update.

The optional LaMa weights are downloaded from the model release linked by
[simple-lama-inpainting](https://github.com/enesmsahin/simple-lama-inpainting/blob/main/simple_lama_inpainting/models/model.py).
They are not shipped in this package. The Python runner is a new implementation;
the model and its upstream licensing are separate from this CLI.

Google Flow, Grok and model names identify interoperable services. Flow Behind
does not imply endorsement or affiliation with those providers or the original
Flow Connector author.

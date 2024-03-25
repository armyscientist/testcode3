#this is a demo
import tree_sitter

# Initialize the parser
parser = tree_sitter.Parser()
parser.set_language(tree_sitter.Language('python'))

# Load the source code
with open("dummy_code.py", "r") as f:
    source_code = f.read()

# Parse the source code
tree = parser.parse(source_code)

# Traverse the tree and extract information
def updated_visit(node):
    if node.type == "function_definition":
        print(f"Function: {node.child(1).text}")
        for child in node.children:
            if child.type == "function_signature":
                print(f"  Parameters: {child.child(1).text}")
            elif child.type == "block":
                print("  Body:")
                for sub_child in child.children:
                    visit(sub_child)

visit(tree.root_node)

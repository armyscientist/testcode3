import hashlib, os

def hashfiles(prog_file_paths, DIR_PATH):
    """
    This function takes a list of file paths and a directory path as input and returns a dictionary of file paths and their corresponding SHA256 hash values.

    :param prog_file_paths: List of file paths
    :type prog_file_paths: list
    :param dir_path: Directory path
    :type dir_path: str
    :return: Dictionary of file paths and their corresponding SHA256 hash values
    :rtype: dict
    """
    hash_files = dict()
    for file_path in prog_file_paths:
        with open(os.path.join(DIR_PATH, file_path), 'rb') as file:
            chunk = 0
            sha256_hash = hashlib.sha256()
            # Update the hash object with the chunk Read 4096 bytes at a time
            while chunk := file.read(4096): 
                sha256_hash.update(chunk)  
            # Calculate the hexadecimal digest of the hash
            hash_files[file_path] = sha256_hash.hexdigest()
    return hash_files

def compare_files(hash_files_current, hash_files_new):
    """
    This function takes two dictionaries of file paths and their corresponding SHA256 hash values as input and returns three
    lists of updated, deleted and new files.

    :param hash_files_current: Dictionary of file paths and their corresponding SHA256 hash values
    :type hash_files_current: dict
    :param hash_files_new: Dictionary of file paths and their corresponding SHA256 hash values
    :type hash_files_new: dict
    :return: Three lists of updated, deleted and new files
    :rtype: tuple
    """
    updated_files = []
    deleted_files = []
    new_files = []
    is_uptodate = True

    # Compare current and new files
    for file_path, hash_value in hash_files_new.items():
        if file_path in hash_files_current:
            if hash_value != hash_files_current[file_path]:
                is_uptodate=False
                updated_files.append(file_path)
        else:
            is_uptodate=False
            new_files.append(file_path)

    # Compare deleted files
    for file_path in hash_files_current.keys():
        if file_path not in hash_files_new:
            is_uptodate=False
            deleted_files.append(file_path)

    return is_uptodate, updated_files, deleted_files, new_files


        

